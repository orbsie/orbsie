import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {Entity} from './protocol';
export function entityGeometry(entity:Entity):THREE.BufferGeometry{
 const parts:THREE.BufferGeometry[]=[];const coarse=entity.geometry?.detail==='coarse';const segments=coarse?6:14;
 const add=(g:THREE.BufferGeometry,p=[0,0,0],s=[1,1,1],color=entity.color,r=[0,0,0])=>{let geometry=g.index?g.toNonIndexed():g;if(geometry!==g)g.dispose();geometry.deleteAttribute('uv');geometry.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p),new THREE.Quaternion().setFromEuler(new THREE.Euler(...r as [number,number,number])),new THREE.Vector3(...s)));const c=new THREE.Color(color);const colors=new Float32Array(geometry.attributes.position.count*3);for(let i=0;i<colors.length;i+=3){colors[i]=c.r;colors[i+1]=c.g;colors[i+2]=c.b;}geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));parts.push(geometry);};
 const sphere=(p:number[],s:number[],c=entity.color)=>add(new THREE.SphereGeometry(1,segments,segments),p,s,c);
 const cylinder=(p:number[],s:number[],c=entity.color)=>add(new THREE.CylinderGeometry(.65,1,1,segments),p,s,c);
 switch(entity.geometry?.kind){
 case 'tree': cylinder([0,.8,0],[.2,1.6,.2],'#98775a');sphere([0,2,0],[.95,1.05,.9]);if(!coarse){sphere([-.55,1.65,.15],[.6,.75,.6]);sphere([.55,1.9,.15],[.55,.7,.55]);}break;
 case 'mushroom': cylinder([0,.7,0],[.25,1.4,.25],'#f6ebd3');sphere([0,1.5,0],[1.15,.65,1.15]);if(!coarse)for(let i=0;i<7;i++)sphere([Math.cos(i*2.4)*.7,1.94+Math.sin(i)*.05,Math.sin(i*2.4)*.7],[.13,.045,.13],'#fff1de');break;
 case 'platform':add(new THREE.BoxGeometry(1,.45,1,2,2,2),[0,.2,0]);add(new THREE.BoxGeometry(.9,.1,.9),[0,.47,0],[1,1,1],'#fff2cf');break;
 case 'arch':for(const x of [-.8,.8]){cylinder([x,1,0],[.24,2,.25]);add(new THREE.BoxGeometry(.65,.2,.65),[x,.1,0]);}add(new THREE.TorusGeometry(.8,.23,8,24,Math.PI),[0,1.85,0]);if(!coarse)sphere([0,2.75,0],[.16,.16,.16],'#f8d88d');break;
 case 'crystal':add(new THREE.OctahedronGeometry(.65,0),[0,.5,0],[.65,1.25,.65]);break;
 case 'pond':cylinder([0,.02,0],[1.3,.055,1],'#d3d7a8');cylinder([0,.06,0],[1.2,.065,.9],entity.color);break;
 case 'flower':cylinder([0,.5,0],[.055,1,.055],'#779963');for(let i=0;i<(coarse?4:7);i++){const a=i*Math.PI*2/(coarse?4:7);sphere([Math.cos(a)*.3,1.04,Math.sin(a)*.3],[.26,.15,.26]);}sphere([0,1.12,0],[.19,.13,.19],'#ffdf92');sphere([.19,.4,0],[.3,.08,.12],'#91b878');break;
 case 'rock':sphere([0,.35,0],[.7,.55,.6]);sphere([.55,.18,.15],[.35,.3,.4]);break;
 case 'custom':for(const part of entity.geometry.parts??[]){const g=part.shape==='box'?new THREE.BoxGeometry(1,1,1,2,2,2):part.shape==='cone'?new THREE.ConeGeometry(1,1,segments):part.shape==='cylinder'?new THREE.CylinderGeometry(1,1,1,segments):part.shape==='torus'?new THREE.TorusGeometry(.7,.25,8,segments):new THREE.SphereGeometry(1,segments,segments);add(g,part.position,part.scale,part.color,part.rotation);}break;
 default:sphere([0,.65,0],[.5,.5,.5],'#bceee0');
 }
 if(!parts.length)sphere([0,.5,0],[.5,.5,.5]);
 const merged=mergeGeometries(parts);parts.forEach(g=>g.dispose());merged.computeBoundingSphere();return merged;
}
export function addFormationSource(geometry:THREE.BufferGeometry,previous?:Float32Array){
 const position=geometry.getAttribute('position');const source=new Float32Array(position.count*3);
 for(let i=0;i<position.count;i++){
  if(previous){const n=(i%(previous.length/3))*3;source[i*3]=previous[n];source[i*3+1]=previous[n+1];source[i*3+2]=previous[n+2];}
  else{const y=1-2*(i+.5)/position.count,a=i*2.399963,r=Math.sqrt(1-y*y)*.58;source[i*3]=Math.cos(a)*r;source[i*3+1]=y*.58+.7;source[i*3+2]=Math.sin(a)*r;}
 }
 geometry.setAttribute('aFrom',new THREE.BufferAttribute(source,3));return geometry;
}
export function terrainValue(x:number,y:number,z:number){return Math.sin(x*2.3+Math.cos(z*3.1))*Math.cos(y*2.8-z)+Math.sin(z*4+x*1.3)*.32+Math.sin(y*7-z*4)*.15;}
