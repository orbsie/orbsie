import Module from 'manifold-3d';
import assert from 'node:assert/strict';
const start=performance.now();
const wasm=await Module(); wasm.setup();
const initialized=performance.now();
const {Manifold}=wasm;
const owned=[];
const keep=x=>(owned.push(x),x);
try {
 const box=keep(Manifold.cube([6,4,1.5],true));
 const cylinder=keep(Manifold.cylinder(2,1.8,1.8,48,true));
 const cutter=keep(cylinder.translate([0,-1,0]));
 const arch=keep(box.subtract(cutter));
 const taller=keep(cutter.scale([1,1.2,1]));
 const edited=keep(box.subtract(taller));
 assert.equal(arch.status(),'NoError'); assert.equal(edited.status(),'NoError');
 assert(arch.numTri()>0 && edited.volume()<arch.volume());
 console.log(JSON.stringify({scope:'Node WASM geometry only; no browser/worker/scene validation',version:'3.3.2',initializationMs:initialized-start,constructionMs:performance.now()-initialized,arch:{triangles:arch.numTri(),volume:arch.volume(),bounds:arch.boundingBox()},edited:{triangles:edited.numTri(),volume:edited.volume(),bounds:edited.boundingBox()},inferenceCalls:0},null,2));
} finally { for(const object of owned.reverse()) object.delete(); }
