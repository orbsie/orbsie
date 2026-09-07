import {describe,it,expect} from 'vitest';
import {blankProject,applyOperation,commandSchema,committed,type Command,type Cursor} from '../src/lib/protocol';
import {fixtureCommands} from '../src/lib/fixtures';
import {encodeWorld,decodeWorld} from '../src/lib/export';
const seed:Command={type:'reserve_entity',entity:{id:'tree',label:'Tree',position:[0,0,0],scale:[1,1,1],color:'#00aa00',stage:'seed'}};
function setup(){const project=blankProject();const cursor:Cursor={runId:'run',sequence:0,seen:new Set()};const op={version:1,projectId:project.id,runId:'run',operationId:'op',sequence:1,baseRevision:0,command:seed};return {project,cursor,op};}
describe('scene protocol',()=>{
 it('accepts an ordered reservation and ignores exact retries',()=>{const {project,cursor,op}=setup();const a=applyOperation(project,op,cursor);expect(a.project.entities).toHaveLength(1);expect(applyOperation(a.project,op,a.cursor).project).toBe(a.project);});
 it('rejects stale revisions, stale runs, and out-of-order records',()=>{const {project,cursor,op}=setup();for(const patch of [{baseRevision:4},{sequence:3},{runId:'old'},{projectId:'other'}])expect(()=>applyOperation(project,{...op,...patch},cursor)).toThrow();});
 it('rejects invalid geometry and references',()=>{expect(commandSchema.safeParse({type:'set_transform',id:'x',position:[Infinity,0,0]}).success).toBe(false);const {project,cursor,op}=setup();expect(()=>applyOperation(project,{...op,command:{type:'set_material',id:'missing',color:'#ffffff'}},cursor)).toThrow();});
 it('removes pending reservations from checkpoints',()=>{const {project,cursor,op}=setup();expect(committed(applyOperation(project,op,cursor).project).entities).toHaveLength(0);});
 it('builds both fixtures through the same bounded protocol',()=>{for(const garden of [false,true]){let {project,cursor}=setup();for(const command of fixtureCommands(garden)){const out=applyOperation(project,{version:1,projectId:project.id,runId:'run',operationId:crypto.randomUUID(),sequence:cursor.sequence+1,baseRevision:project.revision,command},cursor);project=out.project;cursor=out.cursor;}expect(project.entities.length).toBeGreaterThan(10);expect(project.entities.every(e=>e.stage==='ready')).toBe(true);const shared=decodeWorld(encodeWorld(project));expect(shared.entities).toEqual(project.entities);expect(shared.messages).toEqual([]);}});
});
