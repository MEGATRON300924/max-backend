import { Router } from 'express';
import { z } from 'zod';
import { prisma, Prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../types/auth.js';
import { resolveEcosystemUser } from '../services/user.service.js';
import { createEvent } from '../services/event.service.js';
import { ApiError } from '../middleware/errors.js';

const router = Router();
router.use(requireAuth);

const id = z.string().uuid();
const json = z.record(z.unknown());

async function actor(req: AuthenticatedRequest) {
  return resolveEcosystemUser(req.auth!);
}

async function membership(userId: string, homeId: string) {
  const member = await prisma.homeMember.findUnique({ where: { homeId_userId: { homeId, userId } } });
  if (!member) throw new ApiError(403, 'HOME_ACCESS_DENIED', 'You are not a member of this home');
  if (member.homeId !== homeId) throw new ApiError(403, 'HOME_ACCESS_DENIED', 'Home access denied');
  return member;
}

async function requireRole(userId: string, homeId: string, roles: string[]) {
  const member = await membership(userId, homeId);
  if (!roles.includes(member.role)) throw new ApiError(403, 'HOME_PERMISSION_DENIED', 'You do not have permission for this action');
  return member;
}

const homeCreate = z.object({ name: z.string().trim().min(1).max(120), timezone: z.string().max(100).optional(), latitude: z.number().optional(), longitude: z.number().optional(), settings: json.optional() });
router.post('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await actor(req), input = homeCreate.parse(req.body);
    const home = await prisma.home.create({ data: { ...input, ownerId: user.id, settings: input.settings as Prisma.InputJsonValue | undefined, members: { create: { userId: user.id, role: 'OWNER' } } }, include: { members: true } });
    res.status(201).json({ data: home });
  } catch (e) { next(e); }
});

router.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await actor(req);
    const memberships = await prisma.homeMember.findMany({ where: { userId: user.id }, include: { home: true }, orderBy: { joinedAt: 'asc' } });
    res.json({ data: memberships.map(m => ({ ...m.home, role: m.role, permissions: m.permissions, privacy: m.privacy })) });
  } catch (e) { next(e); }
});

router.get('/:homeId', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await actor(req); await membership(user.id, req.params.homeId);
    const home = await prisma.home.findUnique({ where: { id: req.params.homeId }, include: { members: true, rooms: true, modes: true, automations: true, scenes: true } });
    if (!home) throw new ApiError(404, 'HOME_NOT_FOUND', 'Home not found');
    res.json({ data: home });
  } catch (e) { next(e); }
});

router.patch('/:homeId', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await actor(req); await requireRole(user.id, req.params.homeId, ['OWNER','ADMIN']);
    const input = homeCreate.partial().parse(req.body);
    const home = await prisma.home.update({ where: { id: req.params.homeId }, data: { ...input, settings: input.settings as Prisma.InputJsonValue | undefined } });
    res.json({ data: home });
  } catch (e) { next(e); }
});

router.delete('/:homeId', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await actor(req); await requireRole(user.id, req.params.homeId, ['OWNER']);
    await prisma.home.delete({ where: { id: req.params.homeId } });
    res.status(204).send();
  } catch (e) { next(e); }
});

router.post('/:homeId/members', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await actor(req); await requireRole(user.id, req.params.homeId, ['OWNER','ADMIN']);
    const input = z.object({ userId: id, role: z.enum(['ADMIN','MEMBER','CHILD','GUEST']), permissions: json.optional(), privacy: json.optional() }).parse(req.body);
    const member = await prisma.homeMember.upsert({ where: { homeId_userId: { homeId: req.params.homeId, userId: input.userId } }, update: { role: input.role, permissions: input.permissions as Prisma.InputJsonValue | undefined, privacy: input.privacy as Prisma.InputJsonValue | undefined }, create: { homeId: req.params.homeId, ...input, permissions: input.permissions as Prisma.InputJsonValue | undefined, privacy: input.privacy as Prisma.InputJsonValue | undefined } });
    res.status(201).json({ data: member });
  } catch (e) { next(e); }
});

router.get('/:homeId/members', async (req: AuthenticatedRequest, res, next) => {
  try { const user = await actor(req); await membership(user.id, req.params.homeId); res.json({ data: await prisma.homeMember.findMany({ where: { homeId: req.params.homeId } }) }); } catch(e){next(e);}
});

router.post('/:homeId/rooms', async (req: AuthenticatedRequest,res,next)=>{
  try { const user=await actor(req); await requireRole(user.id,req.params.homeId,['OWNER','ADMIN']); const x=z.object({name:z.string().min(1).max(100),settings:json.optional()}).parse(req.body); const r=await prisma.homeRoom.create({data:{homeId:req.params.homeId,name:x.name,settings:x.settings as Prisma.InputJsonValue|undefined}}); res.status(201).json({data:r}); }catch(e){next(e);}
});
router.get('/:homeId/rooms', async (req: AuthenticatedRequest,res,next)=>{try{const user=await actor(req);await membership(user.id,req.params.homeId);res.json({data:await prisma.homeRoom.findMany({where:{homeId:req.params.homeId},orderBy:{name:'asc'}})});}catch(e){next(e);}});

router.post('/:homeId/modes', async (req: AuthenticatedRequest,res,next)=>{
  try{const user=await actor(req);await requireRole(user.id,req.params.homeId,['OWNER','ADMIN','MEMBER']);const x=z.object({type:z.enum(['STUDY','WORSHIP','VISITOR','DINNER','FAMILY_TIME','SLEEP','MOVIE','TRAVEL','CLEANING','EMERGENCY','CUSTOM']),name:z.string().min(1).max(100),config:json.optional(),enabled:z.boolean().optional()}).parse(req.body);const m=await prisma.homeMode.create({data:{homeId:req.params.homeId,...x,config:x.config as Prisma.InputJsonValue|undefined}});res.status(201).json({data:m});}catch(e){next(e);}
});
router.post('/:homeId/modes/:modeId/activate', async(req:AuthenticatedRequest,res,next)=>{try{const user=await actor(req);await membership(user.id,req.params.homeId);const m=await prisma.homeMode.update({where:{id:req.params.modeId},data:{enabled:true}});await createEvent({userId:user.id,homeId:req.params.homeId,eventType:'AUTOMATION_EVENT',priority:'NORMAL',payload:{type:'MODE_CHANGED',modeId:m.id,enabled:true},targetType:'home',targetId:req.params.homeId});res.json({data:m});}catch(e){next(e);}});
router.post('/:homeId/modes/:modeId/deactivate', async(req:AuthenticatedRequest,res,next)=>{try{const user=await actor(req);await membership(user.id,req.params.homeId);const m=await prisma.homeMode.update({where:{id:req.params.modeId},data:{enabled:false}});await createEvent({userId:user.id,homeId:req.params.homeId,eventType:'AUTOMATION_EVENT',priority:'NORMAL',payload:{type:'MODE_CHANGED',modeId:m.id,enabled:false},targetType:'home',targetId:req.params.homeId});res.json({data:m});}catch(e){next(e);}});

const automation=z.object({name:z.string().min(1).max(120),triggers:z.unknown(),conditions:z.unknown().optional(),actions:z.unknown(),schedule:z.unknown().optional()});
router.post('/:homeId/automations',async(req:AuthenticatedRequest,res,next)=>{try{const user=await actor(req);await requireRole(user.id,req.params.homeId,['OWNER','ADMIN']);const x=automation.parse(req.body);const a=await prisma.homeAutomation.create({data:{homeId:req.params.homeId,name:x.name,triggers:x.triggers as Prisma.InputJsonValue,conditions:x.conditions as Prisma.InputJsonValue|undefined,actions:x.actions as Prisma.InputJsonValue,schedule:x.schedule as Prisma.InputJsonValue|undefined}});res.status(201).json({data:a});}catch(e){next(e);}});
router.get('/:homeId/automations',async(req:AuthenticatedRequest,res,next)=>{try{const user=await actor(req);await membership(user.id,req.params.homeId);res.json({data:await prisma.homeAutomation.findMany({where:{homeId:req.params.homeId}})});}catch(e){next(e);}});
router.patch('/:homeId/automations/:automationId',async(req:AuthenticatedRequest,res,next)=>{try{const user=await actor(req);await requireRole(user.id,req.params.homeId,['OWNER','ADMIN']);const x=automation.partial().extend({status:z.enum(['ENABLED','PAUSED','DISABLED']).optional()}).parse(req.body);const a=await prisma.homeAutomation.update({where:{id:req.params.automationId},data:{...x,triggers:x.triggers as Prisma.InputJsonValue|undefined,conditions:x.conditions as Prisma.InputJsonValue|undefined,actions:x.actions as Prisma.InputJsonValue|undefined,schedule:x.schedule as Prisma.InputJsonValue|undefined}});res.json({data:a});}catch(e){next(e);}});

router.post('/:homeId/scenes',async(req:AuthenticatedRequest,res,next)=>{try{const user=await actor(req);await requireRole(user.id,req.params.homeId,['OWNER','ADMIN']);const x=z.object({name:z.string().min(1).max(120),actions:z.unknown()}).parse(req.body);const s=await prisma.homeScene.create({data:{homeId:req.params.homeId,name:x.name,actions:x.actions as Prisma.InputJsonValue}});res.status(201).json({data:s});}catch(e){next(e);}});

router.post('/:homeId/notifications',async(req:AuthenticatedRequest,res,next)=>{try{const user=await actor(req);await membership(user.id,req.params.homeId);const x=z.object({message:z.string().min(1).max(5000),priority:z.enum(['INFO','NORMAL','IMPORTANT','CRITICAL']).default('NORMAL'),channel:z.string().max(40).default('MAX'),userId:id.optional(),targetType:z.string().max(40).optional(),targetId:z.string().max(200).optional()}).parse(req.body);const n=await prisma.homeNotification.create({data:{homeId:req.params.homeId,userId:x.userId,eventId:null,message:x.message,priority:x.priority,status:'PENDING',channel:x.channel,targetType:x.targetType,targetId:x.targetId}});res.status(201).json({data:n});}catch(e){next(e);}});
router.get('/:homeId/notifications',async(req:AuthenticatedRequest,res,next)=>{try{const user=await actor(req);await membership(user.id,req.params.homeId);res.json({data:await prisma.homeNotification.findMany({where:{homeId:req.params.homeId},orderBy:{createdAt:'desc'},take:100})});}catch(e){next(e);}});

router.post('/:homeId/incidents',async(req:AuthenticatedRequest,res,next)=>{try{const user=await actor(req);await membership(user.id,req.params.homeId);const x=z.object({type:z.string().max(80),message:z.string().min(1).max(5000),priority:z.enum(['INFO','NORMAL','IMPORTANT','CRITICAL']).default('CRITICAL'),metadata:json.optional()}).parse(req.body);const i=await prisma.homeIncident.create({data:{homeId:req.params.homeId,userId:user.id,type:x.type,message:x.message,priority:x.priority,metadata:x.metadata as Prisma.InputJsonValue|undefined}});await createEvent({userId:user.id,homeId:req.params.homeId,eventType:'SECURITY_ALERT',priority:x.priority,payload:{incidentId:i.id,type:x.type,message:x.message},targetType:'home',targetId:req.params.homeId});res.status(201).json({data:i});}catch(e){next(e);}});
router.patch('/:homeId/incidents/:incidentId',async(req:AuthenticatedRequest,res,next)=>{try{const user=await actor(req);await membership(user.id,req.params.homeId);const status=z.object({status:z.enum(['ACKNOWLEDGED','RESOLVED','CANCELLED'])}).parse(req.body).status;const now=new Date();const i=await prisma.homeIncident.update({where:{id:req.params.incidentId},data:{status,acknowledgedAt:status==='ACKNOWLEDGED'?now:undefined,resolvedAt:status==='RESOLVED'?now:undefined,cancelledAt:status==='CANCELLED'?now:undefined}});res.json({data:i});}catch(e){next(e);}});

router.post('/:homeId/location',async(req:AuthenticatedRequest,res,next)=>{try{const user=await actor(req);await membership(user.id,req.params.homeId);const x=z.object({latitude:z.number().gte(-90).lte(90),longitude:z.number().gte(-180).lte(180),accuracy:z.number().nonnegative().optional(),battery:z.number().int().min(0).max(100).optional(),source:z.string().max(50).optional()}).parse(req.body);const l=await prisma.homeLocation.create({data:{homeId:req.params.homeId,userId:user.id,...x}});res.status(201).json({data:l});}catch(e){next(e);}});
router.get('/:homeId/health',async(req:AuthenticatedRequest,res,next)=>{try{const user=await actor(req);await membership(user.id,req.params.homeId);const [issues,devices,automations,integrations]=await Promise.all([prisma.homeHealthIssue.findMany({where:{homeId:req.params.homeId,resolvedAt:null}}),prisma.device.findMany({where:{homeId:req.params.homeId,revokedAt:null}}),prisma.homeAutomation.findMany({where:{homeId:req.params.homeId}}),prisma.homeIntegration.findMany({where:{homeId:req.params.homeId}})]);const offline=devices.filter(d=>!d.lastSeenAt||Date.now()-d.lastSeenAt.getTime()>15*60*1000).length;const failed=automations.filter(a=>a.status==='FAILED').length;const integrationDown=integrations.filter(i=>i.status!=='connected').length;const penalty=Math.min(100,issues.length*8+offline*4+failed*6+integrationDown*5);res.json({data:{score:Math.max(0,100-penalty),issues,summary:{devices:devices.length,offlineDevices:offline,failedAutomations:failed,unhealthyIntegrations:integrationDown}}});}catch(e){next(e);}});
router.get('/:homeId/integrations',async(req:AuthenticatedRequest,res,next)=>{try{const user=await actor(req);await membership(user.id,req.params.homeId);res.json({data:await prisma.homeIntegration.findMany({where:{homeId:req.params.homeId}})});}catch(e){next(e);}});
router.get('/:homeId/energy',async(req:AuthenticatedRequest,res,next)=>{try{const user=await actor(req);await membership(user.id,req.params.homeId);res.json({data:await prisma.homeEnergyReading.findMany({where:{homeId:req.params.homeId},orderBy:{recordedAt:'desc'},take:500})});}catch(e){next(e);}});
router.post('/:homeId/tasks',async(req:AuthenticatedRequest,res,next)=>{try{const user=await actor(req);await membership(user.id,req.params.homeId);const x=z.object({title:z.string().min(1).max(200),assignedTo:id.optional(),dueAt:z.string().datetime().optional(),metadata:json.optional()}).parse(req.body);const t=await prisma.homeTask.create({data:{homeId:req.params.homeId,title:x.title,assignedTo:x.assignedTo,dueAt:x.dueAt?new Date(x.dueAt):undefined,metadata:x.metadata as Prisma.InputJsonValue|undefined}});res.status(201).json({data:t});}catch(e){next(e);}});
router.get('/:homeId/tasks',async(req:AuthenticatedRequest,res,next)=>{try{const user=await actor(req);await membership(user.id,req.params.homeId);res.json({data:await prisma.homeTask.findMany({where:{homeId:req.params.homeId},orderBy:{dueAt:'asc'}})});}catch(e){next(e);}});
router.post('/:homeId/calendar',async(req:AuthenticatedRequest,res,next)=>{try{const user=await actor(req);await membership(user.id,req.params.homeId);const x=z.object({title:z.string().min(1).max(200),description:z.string().max(5000).optional(),startsAt:z.string().datetime(),endsAt:z.string().datetime().optional(),metadata:json.optional()}).parse(req.body);const e=await prisma.homeCalendarEvent.create({data:{homeId:req.params.homeId,title:x.title,description:x.description,startsAt:new Date(x.startsAt),endsAt:x.endsAt?new Date(x.endsAt):undefined,createdBy:user.id,metadata:x.metadata as Prisma.InputJsonValue|undefined}});res.status(201).json({data:e});}catch(e){next(e);}});
router.get('/:homeId/calendar',async(req:AuthenticatedRequest,res,next)=>{try{const user=await actor(req);await membership(user.id,req.params.homeId);res.json({data:await prisma.homeCalendarEvent.findMany({where:{homeId:req.params.homeId},orderBy:{startsAt:'asc'}})});}catch(e){next(e);}});

export const maxHomeCoreRouter = router;
