const { io } = require('socket.io-client');
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../src/utils/auth');
const { queryAsync } = require('../src/config/database');
const users = [['driver','pre-driver-1@demo.schoolsync.local'],['parent','pre-parent-1@demo.schoolsync.local'],['student','pre-student-1@demo.schoolsync.local'],['admin','pre-admin@demo.schoolsync.local']];
const SOCKET_TEST_URL = process.env.SOCKET_TEST_URL;
if (!SOCKET_TEST_URL) {
  console.error('SOCKET_TEST_URL is required (for example http://127.0.0.1:3190).');
  process.exit(2);
}
async function token(email){const r=await queryAsync('SELECT id,role,school_id FROM users WHERE email=?',[email]);if(!r[0])throw new Error(`Missing test user ${email}`);return jwt.sign({id:r[0].id,role:r[0].role},getJwtSecret());}
function check(name,tok){return new Promise(resolve=>{const s=io(SOCKET_TEST_URL,{auth:{token:tok},transports:['websocket'],timeout:2500});let done=false;const finish=x=>{if(done)return;done=true;s.close();resolve([name,x]);};s.on('connect',()=>s.emit('join_trip',{trip_id:1}));s.on('trip_joined',()=>finish('joined'));s.on('connect_error',e=>finish(`rejected:${e.message}`));setTimeout(()=>finish('connected-no-join'),1800);});}
(async()=>{
 const results=[];
 for(const [n,e] of users){const result=await check(n,await token(e));results.push(result);console.log(result);}
 const unauthorized=await check('unauthorized','invalid'); console.log(unauthorized);
 if (!results.every(([,state])=>state==='joined') || !String(unauthorized[1]).startsWith('rejected:')) throw new Error('Socket room/auth matrix failed');
 const parent=io(SOCKET_TEST_URL,{auth:{token:await token('pre-parent-1@demo.schoolsync.local')},transports:['websocket']});
 const driver=io(SOCKET_TEST_URL,{auth:{token:await token('pre-driver-1@demo.schoolsync.local')},transports:['websocket']});
 await Promise.all([new Promise(r=>parent.on('connect',r)),new Promise(r=>driver.on('connect',r))]);
 let received=0; parent.on('location_updated',()=>received++); parent.emit('join_trip',{trip_id:1}); driver.emit('join_trip',{trip_id:1});
 await new Promise(r=>setTimeout(r,150)); driver.emit('update_location',{trip_id:1,latitude:999,longitude:72}); await new Promise(r=>setTimeout(r,150)); driver.emit('update_location',{trip_id:1,latitude:21.17,longitude:72.83}); await new Promise(r=>setTimeout(r,300));
 console.log(['gps_broadcasts',received]); parent.close();driver.close(); if(received < 1) throw new Error('Authorized GPS was not broadcast'); process.exit(0)
})().catch(e=>{console.error(e);process.exit(1)});
