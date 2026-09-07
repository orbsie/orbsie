import { z } from 'zod';
export const vector = z.tuple([z.number().finite().min(-100).max(100),z.number().finite().min(-100).max(100),z.number().finite().min(-100).max(100)]);
export const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const partSchema = z.object({shape:z.enum(['box','sphere','cone','cylinder','torus']),position:vector,scale:vector,rotation:vector.optional(),color});
export const geometrySchema = z.object({kind:z.enum(['tree','mushroom','platform','arch','crystal','pond','flower','rock','custom']),parts:z.array(partSchema).max(32).optional(),detail:z.enum(['coarse','refined']).default('refined')});
export const behaviorSchema = z.object({type:z.enum(['static','collect','move','portal','bloom','bounce']),speed:z.number().min(0).max(5).optional(),amplitude:z.number().min(0).max(8).optional(),axis:z.enum(['x','y','z']).optional()});
export const entitySchema = z.object({id:z.string().regex(/^[\w-]{1,80}$/),label:z.string().max(100),position:vector,scale:vector.default([1,1,1]),color:color.default('#6ead60'),geometry:geometrySchema.optional(),behavior:behaviorSchema.optional(),stage:z.enum(['seed','coarse','ready']).default('seed')});
export type Entity = z.infer<typeof entitySchema>;
export type GeometryRecipe = z.infer<typeof geometrySchema>;
export const projectSchema = z.object({version:z.literal(1),id:z.string().max(80),title:z.string().max(100),seed:z.number().int(),revision:z.number().int().min(0),entities:z.array(entitySchema).max(160),environment:z.object({sky:color,ground:color,water:color}),messages:z.array(z.object({role:z.enum(['user','assistant']),text:z.string().max(5000),entityId:z.string().optional()})).max(500)});
export type Project = z.infer<typeof projectSchema>;
export const commandSchema = z.discriminatedUnion('type',[
 z.object({type:z.literal('reserve_entity'),entity:entitySchema}),
 z.object({type:z.literal('set_geometry'),id:z.string(),geometry:geometrySchema}),
 z.object({type:z.literal('set_material'),id:z.string(),color}),
 z.object({type:z.literal('set_transform'),id:z.string(),position:vector.optional(),scale:vector.optional()}),
 z.object({type:z.literal('set_behavior'),id:z.string(),behavior:behaviorSchema}),
 z.object({type:z.literal('remove_entity'),id:z.string()}),
 z.object({type:z.literal('set_environment'),sky:color.optional(),ground:color.optional(),water:color.optional()}),
 z.object({type:z.literal('commit_revision'),message:z.string().max(1000)})
]);
export type Command = z.infer<typeof commandSchema>;
export const envelopeSchema=z.object({version:z.literal(1),projectId:z.string(),runId:z.string(),operationId:z.string(),sequence:z.number().int().min(1),baseRevision:z.number().int().min(0),command:commandSchema});
export type Envelope=z.infer<typeof envelopeSchema>;
export type Cursor={runId:string,sequence:number,seen:Set<string>};
export function blankProject():Project{return {version:1,id:crypto.randomUUID(),title:'An untitled little world',seed:42,revision:0,entities:[],environment:{sky:'#dceee9',ground:'#91b977',water:'#59bdbb'},messages:[]};}
export function applyOperation(project:Project,input:unknown,cursor:Cursor):{project:Project,cursor:Cursor}{
 const op=envelopeSchema.parse(input);
 if(cursor.seen.has(op.operationId))return {project,cursor};
 if(op.projectId!==project.id||op.runId!==cursor.runId)throw Error('This change belongs to another world or an expired run.');
 if(op.sequence!==cursor.sequence+1)throw Error('A scene update arrived out of order. Retry from your saved world.');
 if(op.baseRevision!==project.revision)throw Error('Your world has a newer revision. This change was not applied.');
 const c=op.command;let entities=project.entities;let environment=project.environment;let messages=project.messages;
 if(c.type==='reserve_entity'){
  if(entities.some(e=>e.id===c.entity.id))throw Error('Object already exists.');
  if(entities.length>=160)throw Error('This world reached its 160-object limit.');
  entities=[...entities,{...c.entity,stage:'seed'}];
 }else if(c.type==='set_environment'){
  environment={sky:c.sky??environment.sky,ground:c.ground??environment.ground,water:c.water??environment.water};
 }else if(c.type==='commit_revision'){
  messages=[...messages,{role:'assistant',text:c.message}];
 }else{
  if(!entities.some(e=>e.id===c.id))throw Error('That object no longer exists.');
  if(c.type==='remove_entity')entities=entities.filter(e=>e.id!==c.id);
  else entities=entities.map(e=>e.id!==c.id?e:c.type==='set_geometry'?{...e,geometry:c.geometry,stage:c.geometry.detail==='coarse'?'coarse':'ready'}:c.type==='set_material'?{...e,color:c.color}:c.type==='set_behavior'?{...e,behavior:c.behavior}:{...e,position:c.position??e.position,scale:c.scale??e.scale});
 }
 const next:Project={...project,entities,environment,messages,revision:project.revision+1};
 projectSchema.parse(next);
 return {project:next,cursor:{runId:cursor.runId,sequence:op.sequence,seen:new Set([...cursor.seen,op.operationId])}};
}
export function committed(project:Project):Project{return {...project,entities:project.entities.filter(e=>e.stage==='ready')};}
