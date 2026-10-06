import http from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const uuid='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
export function allowed(method,pathname){
  if(method==='GET'&&(pathname==='/api/v1/work-reports'||new RegExp(`^/api/v1/work-reports/${uuid}(/events|/html)?$`).test(pathname)))return true;
  if(method==='POST'&&(pathname==='/api/v1/work-reports/collect'||new RegExp(`^/api/v1/work-reports/${uuid}/review$`).test(pathname)))return true;
  if(['GET','POST'].includes(method)&&/^\/api\/v1\/mail\/releases\/(artifacts|experiments|comparisons)$/.test(pathname))return true;
  if(method==='GET'&&new RegExp(`^/api/v1/mail/releases/experiments/${uuid}$`).test(pathname))return true;
  if(method==='POST'&&new RegExp(`^/api/v1/mail/releases/(experiments/${uuid}/reviews|comparisons/${uuid}/approval)$`).test(pathname))return true;
  if(method==='GET'&&(pathname==='/api/v1/mail/evaluations'||new RegExp(`^/api/v1/mail/evaluations/${uuid}$`).test(pathname)))return true;
  if(method==='POST'&&pathname==='/api/v1/mail/evaluations')return true;
  if(method==='GET')return pathname==='/api/v1/mail/jobs'||new RegExp(`^/api/v1/mail/jobs/${uuid}(/events)?$`).test(pathname);
  if(method==='POST')return pathname==='/api/v1/mail/collect'||new RegExp(`^/api/v1/mail/jobs/${uuid}/(analyze|approve|save-draft|review)$`).test(pathname);
  return method==='PATCH'&&new RegExp(`^/api/v1/mail/jobs/${uuid}$`).test(pathname);
}
export function createBridge({token,upstream='http://127.0.0.1:18010',port=5180,dist,fetchFn=fetch,publicOrigin,allowedEmails=[]}){
  if(publicOrigin&&(!publicOrigin.startsWith('https://')||!allowedEmails.length))throw Error('HTTPS origin and explicit login accounts are required');
  const sessions=new Map(),origin=publicOrigin||`http://127.0.0.1:${port}`,cookieName=publicOrigin?'__Host-jarvis_live':`jarvis_live_${port}`;
  const host=new URL(origin).host;
  const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  return http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','no-referrer');
    try{
      if(req.headers.host!==host||(req.headers['sec-fetch-site']==='cross-site'&&(!publicOrigin||req.url.startsWith('/api/')))||(req.headers.origin&&req.headers.origin!==origin))return json(res,403,{error:'허용되지 않은 요청입니다.'});
      // Hosted listener MUST be loopback-only behind oauth2-proxy, which replaces these headers.
      const email=publicOrigin?String(req.headers['x-forwarded-email']||'').toLowerCase():'local';
      if(publicOrigin&&!allowedEmails.includes(email))return json(res,401,{error:'로그인이 필요합니다.'});
      const url=new URL(req.url,origin),pathname=url.pathname;
      if(pathname==='/api/live/session'&&req.method==='GET'){
        const now=Date.now();for(const [id,s] of sessions)if(s.expiry<now)sessions.delete(id);
        const oldId=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
        if(sessions.has(oldId)&&sessions.get(oldId).email===email)return json(res,200,{csrfToken:sessions.get(oldId).csrf});
        if(sessions.size>100)return json(res,429,{error:'열린 창이 너무 많습니다.'});
        const sid=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
        sessions.set(sid,{csrf,email,expiry:now+8*3600000});res.setHeader('Set-Cookie',`${cookieName}=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${publicOrigin?'; Secure':''}`);
        return json(res,200,{csrfToken:csrf});
      }
      if(pathname.startsWith('/api/')){
        if(!allowed(req.method,pathname))return json(res,404,{error:'지원하지 않는 작업입니다.'});
        const sid=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
        const session=sessions.get(sid);
        if(!session||session.expiry<Date.now()||session.email!==email)return json(res,401,{error:'연결 시간이 만료됐습니다. 화면을 새로고침해 주세요.'});
        if(req.method!=='GET'){
          const provided=Buffer.from(String(req.headers['x-csrf-token']||'')),expected=Buffer.from(session.csrf);
          if(req.headers.origin!==origin||provided.length!==expected.length||!timingSafeEqual(provided,expected))return json(res,403,{error:'요청을 확인할 수 없습니다. 화면을 새로고침해 주세요.'});
        }
        let size=0;const chunks=[];
        for await(const chunk of req){size+=chunk.length;if(size>128000)return json(res,413,{error:'입력 내용이 너무 깁니다.'});chunks.push(chunk);}
        const body=Buffer.concat(chunks).toString('utf8');
        const response=await fetchFn(upstream+pathname,{method:req.method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Jarvis-Reviewer':session.email},body:req.method==='GET'?undefined:(body||'{}'),signal:AbortSignal.timeout(900000)});
        if(pathname.endsWith('/html')){
          const content=Buffer.from(await response.arrayBuffer()),disposition=response.headers.get('content-disposition')||'attachment; filename="work-report.html"';
          res.writeHead(response.status,{'Content-Type':'application/octet-stream','Content-Disposition':disposition});res.end(content);return;
        }
        const data=await response.json();return json(res,response.status,data);
      }
      if(req.method!=='GET')return json(res,405,{error:'허용되지 않은 요청입니다.'});
      const pwaFile=pathname==='/manifest.webmanifest'||pathname==='/sw.js'||/^\/icons\/javis-(180|192|512|maskable-512)\.png$/.test(pathname);
      const file=pathname.startsWith('/assets/')||pwaFile?path.resolve(dist,'.'+decodeURIComponent(pathname)):path.join(dist,'index.html');
      if(!file.startsWith(path.resolve(dist)+path.sep))return json(res,404,{error:'파일을 찾지 못했습니다.'});
      const content=await readFile(file);
      const ext=path.extname(file),mime={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.html':'text/html','.webmanifest':'application/manifest+json','.png':'image/png'}[ext]||'application/octet-stream';
      const cache=pathname==='/sw.js'||pathname==='/manifest.webmanifest'?'no-cache':pathname.startsWith('/assets/')||pathname.startsWith('/icons/')?'public, max-age=31536000, immutable':'no-store';
      res.writeHead(200,{'Content-Type':mime+(mime.startsWith('text/')||mime.includes('json')?'; charset=utf-8':''),'Cache-Control':cache});res.end(content);
    }catch{json(res,502,{error:'서버 연결을 확인해 주세요. 저장 중이었다면 작업 상태를 다시 확인해 주세요.'});}
  });
}
