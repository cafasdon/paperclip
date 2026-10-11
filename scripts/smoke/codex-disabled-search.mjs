import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { buildCodexExecArgs } from '../../packages/adapters/codex-local/src/server/codex-args.ts';
import { writeManagedCodexMcpConfig } from '../../packages/adapters/codex-local/src/server/codex-home.ts';
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'paperclip-codex-policy-gateway-'));
const calls = [], outputs = [];
let round = 0; const catalog = new Set();
// The policy response is synthetic; this verifies CLI transport, not live grants.
const wanted = ['read_job', 'write_job', 'denied_job'];
const definitions = wanted.map(name => ({ name, inputSchema: { type: 'object', properties: {} } }));
const server = http.createServer(async (req,res) => {
 let body=''; for await(const c of req) body+=c;
 const data=body?JSON.parse(body):{};
 if(req.url==='/mcp/gateways/fixture') {
  assert.equal(req.headers.authorization,'Bearer synthetic');
  if(data.method==='notifications/initialized'){res.writeHead(202);res.end();return;}
  let result;
  if(data.method==='initialize') result={protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'project-fixture',version:'1'}};
  else if(data.method==='tools/list') result={tools:definitions};
  else if(data.method==='tools/call') {calls.push(data.params.name); if(data.params.name==='denied_job'){res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:data.id,error:{code:-32000,message:'Synthetic server policy denied',data:{reasonCode:'policy_denied'}}}));return;} result={content:[{type:'text',text:JSON.stringify({fixture:true,tool:data.params.name})}]};}
  else result={};
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:data.id,result}));return;
 }
 if(req.url==='/v1/responses') {
  assert.ok(!JSON.stringify(data.tools).match(/\"name\":\"(?:exec_command|shell|shell_command|write_stdin|apply_patch)\"/), 'local execution and patch tools must not be advertised');
  for(const t of data.tools??[]) { if(t.tools) for(const child of t.tools) catalog.add(t.name+'.'+child.name); else catalog.add(t.name??t.type); }
  outputs.push(...(data.input??[]).filter(i=>i.type==='function_call_output'||i.type==='custom_tool_call_output'));
  const next=wanted[round++];
  let item;
  if(next){
   const namespace=data.tools.find(t=>t.name==='mcp__gateway'); const tool=namespace?.tools?.find(t=>t.name===next);
   if(!tool){res.writeHead(500);res.end(JSON.stringify({error:'Missing fixture tool '+next,tools:data.tools.map(t=>t.name)}));return;}
   item={type:'function_call',id:'fc_'+round,call_id:'call_'+round,name:tool.name,namespace:'mcp__gateway',arguments:JSON.stringify(next.startsWith('create_')?{name:'Synthetic',title:'Synthetic',idempotencyKey:'fixture'}:{})};
  } else if(round===4) item={type:'custom_tool_call',id:'patch_probe',call_id:'patch_probe',name:'apply_patch',input:'*** Begin Patch\n*** Add File: forbidden.txt\n+must not be written\n*** End Patch'};
  else item={type:'message',id:'msg_done',role:'assistant',status:'completed',content:[{type:'output_text',text:'Fixture finished.'}]};
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  for(const e of [{type:'response.created',response:{id:'resp_'+round,status:'in_progress'}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id:'resp_'+round,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}])res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  res.end();return;
 }
 res.writeHead(404);res.end();
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const port=server.address().port;
await fs.writeFile(path.join(home,'config.toml'),`model = "gpt-5.4"\nmodel_provider = "fixture"\napproval_policy = "never"\nsandbox_mode = "read-only"\n[model_providers.fixture]\nname = "fixture"\nbase_url = "http://127.0.0.1:${port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`);
await writeManagedCodexMcpConfig({codexHome:home,apiBaseUrl:`http://127.0.0.1:${port}`,gateways:[{name:'gateway',endpointPath:'/mcp/gateways/fixture',bearerToken:'synthetic'}]});
let text='';
try {
 const launch = buildCodexExecArgs({search:false,extraArgs:['--disable','shell_tool','--disable','multi_agent','--disable','browser_use','--disable','browser_use_external','--disable','browser_use_full_cdp_access','--disable','apps','--disable','plugins','--disable','remote_plugin','--disable','computer_use','--disable','image_generation','--disable','in_app_browser','--disable','view_image','--disable','code_mode_host','--disable','workspace_dependencies','--disable','hooks','--disable','shell_snapshot','--disable','skill_mcp_dependency_install','--disable','skill_search','--disable','in_app_local_automation','--disable','daemon_auto_start','--disable','unified_exec','--disable','worktrees','--disable','plugin_sharing','--sandbox','read-only']},{skipGitRepoCheck:true});
 const child=spawn('codex',launch.args,{cwd:home,env:{...process.env,CODEX_HOME:home},stdio:['pipe','pipe','pipe']});
 child.stdin.end('Exercise the synthetic fixture tools.');
 child.stdout.on('data',b=>text+=b);child.stderr.on('data',b=>text+=b);
 const timer=setTimeout(()=>child.kill('SIGKILL'),30000);
 const code=await new Promise(r=>child.on('exit',r));clearTimeout(timer);
 assert.equal(code,0,text);
 assert.deepEqual(calls,wanted,text);
 assert.match(JSON.stringify(outputs.find(item=>item.call_id==='call_3')?.output), /403|Synthetic server policy denied/);
 assert.match(JSON.stringify(outputs.find(item=>item.call_id==='patch_probe')?.output), /unsupported custom tool call: apply_patch/);
 assert.equal(await fs.access(path.join(home,'forbidden.txt')).then(()=>true,()=>false),false,'read-only runtime must not write the patch');
 assert.ok([...catalog].every(name=>name.startsWith('mcp__gateway.')||['list_mcp_resources','list_mcp_resource_templates','read_mcp_resource','request_user_input','get_goal','create_goal','update_goal'].includes(name)), JSON.stringify([...catalog]));
 console.log(JSON.stringify({toolCount:catalog.size,toolNames:[...catalog].sort(),codexExit:code,patchRejected:true,dispatchedTools:calls,policyDenialPreserved:true,shellToolsAdvertised:false,model:'deterministic local Responses fixture',network:'loopback only'}));
} finally {server.close();await fs.rm(home,{recursive:true,force:true});}
