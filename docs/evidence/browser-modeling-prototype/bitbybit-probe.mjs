import Module from 'manifold-3d';
import { initializationComplete, onMessageInput } from '@bitbybit-dev/manifold-worker/lib/manifold-worker/manifold-worker.js';
import assert from 'node:assert/strict';
const start=performance.now();
const wasm=await Module(); wasm.setup(); initializationComplete(wasm,undefined,true);
const ready=performance.now(); let uid=0;
function call(functionName,inputs={}) {
 const id=String(++uid); let reply;
 onMessageInput({uid:id,action:{functionName,inputs:structuredClone(inputs)}}, message=>{if(message?.uid===id) reply=message;});
 assert(reply,'Missing worker-handler response');
 if(reply.error) throw Error(reply.error);
 return reply.result;
}
try {
 const cube=call('manifold.shapes.cube',{size:1,center:true});
 const box=call('manifold.transforms.scale3D',{manifold:cube,vector:[6,4,1.5]});
 const cylinder=call('manifold.shapes.cylinder',{height:2,radiusLow:1.8,radiusHigh:1.8,circularSegments:48,center:true});
 const cutter=call('manifold.transforms.translate',{manifold:cylinder,vector:[0,-1,0]});
 const arch=call('manifold.booleans.differenceTwo',{manifold1:box,manifold2:cutter});
 const taller=call('manifold.transforms.scale3D',{manifold:cutter,vector:[1,1.2,1]});
 const edited=call('manifold.booleans.differenceTwo',{manifold1:box,manifold2:taller});
 const inspect=manifold=>Object.fromEntries(['numTri','volume','boundingBox','status'].map(key=>[key,call('manifold.evaluate.'+key,{manifold})]));
 const a=inspect(arch),b=inspect(edited);
 assert.equal(a.status,'NoError'); assert.equal(b.status,'NoError');
 assert.equal(a.numTri,152); assert.equal(b.numTri,136);
 assert(Math.abs(a.volume-23.288210523297796)<1e-8); assert(b.volume<a.volume);
 console.log(JSON.stringify({scope:'Node worker-handler execution; not a browser Worker',versions:{bitbybit:'1.1.1',manifold:'3.3.2'},initializationMs:ready-start,constructionAndInspectionMs:performance.now()-ready,arch:a,edited:b,inferenceCalls:0},null,2));
} finally {call('cleanAllCache');}
