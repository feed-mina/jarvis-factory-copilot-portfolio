import {readFileSync} from 'node:fs';
import {createBridge} from './live-bridge.mjs';
const root='/docker/jarvis-integration';
const settings=Object.fromEntries(readFileSync(root+'/.secrets/runtime.env','utf8').split(/\r?\n/).filter(x=>x.includes('=')).map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
if(!/^[a-f0-9]{64}$/.test(settings.JARVIS_OPERATOR_TOKEN||''))throw Error('Server credentials unavailable');
createBridge({token:settings.JARVIS_OPERATOR_TOKEN,upstream:'http://127.0.0.1:8010',port:8011,
  dist:root+'/web/dist-live',publicOrigin:'https://jarvis.example.com',
  allowedEmails:['owner@example.com','mailbox@example.com']}).listen(8011,'127.0.0.1',()=>console.log('Hosted bridge ready on loopback'));
