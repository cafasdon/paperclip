import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { projectToolDefinitions } from '../../server/src/services/project-tools.ts';
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'paperclip-codex-project-tools-'));
const calls = [], outputs = [];
let round = 0;
const wanted = ['list_projects', 'list_project_repositories', 'create_project', 'create_task'];
const definitions = projectToolDefinitions('standard', true);
const server = http.createServer(async (req,res) => {
 let body=''; for await(const c of req) body+=c;
 const data=body?JSON.parse(body):{};
 if(req.url==='/mcp') {
  if(data.method==='notifications/initialized'){res.writeHead(202);res.end();return;}
  let result;
  if(data.method==='initialize') result={protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'project-fixture',version:'1'}};
  else if(data.method==='tools/list') result={tools:definitions};
  else if(data.method==='tools/call') {calls.push(data.params.name);result={content:[{type:'text',text:JSON.stringify({fixture:true,tool:data.params.name})}]};}
  else result={};
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:data.id,result}));return;
 }
 if(req.url==='/v1/responses') {
  outputs.push(...(data.input??[]).filter(i=>i.type==='function_call_output'));
  const next=wanted[round++];
  let item;
  if(next){
   const namespace=data.tools.find(t=>t.name==='mcp__project'); const tool=namespace?.tools?.find(t=>t.name===next);
   if(!tool){res.writeHead(500);res.end(JSON.stringify({error:'Missing fixture tool '+next,tools:data.tools.map(t=>t.name)}));return;}
   item={type:'function_call',id:'fc_'+round,call_id:'call_'+round,name:tool.name,namespace:'mcp__project',arguments:JSON.stringify(next.startsWith('create_')?{name:'Synthetic',title:'Synthetic',idempotencyKey:'fixture'}:{})};
  } else item={type:'message',id:'msg_done',role:'assistant',status:'completed',content:[{type:'output_text',text:'Fixture finished.'}]};
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  for(const e of [{type:'response.created',response:{id:'resp_'+round,status:'in_progress'}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id:'resp_'+round,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}])res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  res.end();return;
 }
 res.writeHead(404);res.end();
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const port=server.address().port;
await fs.writeFile(path.join(home,'config.toml'),`model = "gpt-5.4"\nmodel_provider = "fixture"\napproval_policy = "never"\nsandbox_mode = "workspace-write"\n[model_providers.fixture]\nname = "fixture"\nbase_url = "http://127.0.0.1:${port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n[mcp_servers.project]\nurl = "http://127.0.0.1:${port}/mcp"\n`);
let text='';
try {
 const child=spawn('codex',['--disable','plugins','--disable','remote_plugin','--disable','apps','exec','--skip-git-repo-check','--json','Exercise the synthetic fixture tools.'],{cwd:home,env:{...process.env,CODEX_HOME:home},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>text+=b);child.stderr.on('data',b=>text+=b);
 const timer=setTimeout(()=>child.kill('SIGKILL'),30000);
 const code=await new Promise(r=>child.on('exit',r));clearTimeout(timer);
 assert.equal(code,0,text);
 assert.deepEqual(calls,['list_projects','list_project_repositories'],text);
 for (const callId of ['call_3','call_4']) { assert.match(JSON.stringify(outputs.find(item=>item.call_id===callId)?.output), /MCP tool call requires approval, but approval policy is never/); }
 console.log(JSON.stringify({codexExit:code,dispatchedTools:calls,mutationsDenied:true,model:'deterministic local Responses fixture',network:'loopback only'}));
} finally {server.close();await fs.rm(home,{recursive:true,force:true});}




