// Exercise the browser's real outputs against the independent Python validator.
// No API requests, model calls, or credentials are involved.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { SAMPLE_PLAN, clonePlan } from '../src/lib/data.ts';
import { repairInterpretedPlan, repairPlan, validateCandidate } from '../src/lib/planner.ts';

const baseline = {kind:'unknown', targetId:null, minutes:0, description:'Baseline contract check'};
const cases = [];
for (const [disruption, asOf] of [
  ['Maya is 40 minutes late', 540],
  ['Workshop Studio is unavailable', 540],
  ['The build session needs 25 more minutes', 540],
  ['Workshop Studio is unavailable', 790],
  ['showcase is 10 minutes late', 540],
  ['The keynote needs 10 more minutes', 580],
  ['The build session needs 25 more minutes', 810],
]) {
  const plan = {...clonePlan(SAMPLE_PLAN), asOf};
  const result = repairPlan(plan, disruption);
  if (!result.options.length) throw new Error(`Expected feasible contract fixture: ${disruption}`);
  for (const option of result.options) cases.push({name:`${disruption} / ${asOf} / ${option.id}`, plan, sessions:option.sessions, interpretation:result.interpretation});
}
const ongoingPlan = {...clonePlan(SAMPLE_PLAN), asOf:810};
const extension = {kind:'duration', targetId:'build', minutes:25, description:'Extend the selected running activity'};
const ongoingOption = repairInterpretedPlan(ongoingPlan, extension).options[0];
for (const [name, mutate, plan = ongoingPlan] of [
  ['ongoing extension changed original start', s => {s.find(item => item.id === 'build').start = 795;}],
  ['ongoing extension changed original room', s => {s.find(item => item.id === 'build').roomId = 'hall';}],
  ['ongoing extension changed another started activity', s => {s.find(item => item.id === 'keynote').start = 575;}],
  ['completed activity cannot be extended', () => {}, {...clonePlan(SAMPLE_PLAN), asOf:860}],
  ['ongoing locked activity cannot be extended', () => {}, {...ongoingPlan, sessions:ongoingPlan.sessions.map(s => s.id === 'build' ? {...s,locked:true} : s)}],
]) {
  const sessions = structuredClone(ongoingOption.sessions);
  if (name.includes('locked')) sessions.find(s => s.id === 'build').locked = true;
  mutate(sessions);
  cases.push({name, plan, sessions, interpretation:extension});
}
for (const [name, mutate] of [
  ['baseline', () => {}],
  ['owner reassigned', s => {s[1].ownerId = 'leo';}],
  ['activity dropped', s => {s.pop();}],
  ['overlap across rooms', s => {s[2].start = s[1].start;}],
  ['locked activity moved', s => {s[0].start += 5;}],
  ['setup lost across rooms', s => {s[2].start = 610;}],
  ['room capacity lost', s => {s[1].roomId = 'studio';}],
  ['model changed notes', s => {s[1].notes = 'New unchecked instructions';}],
]) {
  const sessions = clonePlan(SAMPLE_PLAN).sessions;
  mutate(sessions);
  cases.push({name, plan:SAMPLE_PLAN, sessions, interpretation:baseline});
}
const python = process.env.RIPPLE_TEST_PYTHON || (existsSync('.venv/bin/python') ? '.venv/bin/python' : 'python3');
const program = `
import json, sys
from server.models import EventPlan, Session, Interpretation
from server.constraints import validate
from server.demo import solve_demo
results=[]
cases=json.load(sys.stdin)
for case in cases:
    plan=EventPlan.model_validate(case['plan'])
    sessions=[Session.model_validate(s) for s in case['sessions']]
    interpretation=None if case['interpretation']['kind']=='unknown' else Interpretation.model_validate(case['interpretation'])
    results.append(all(c.passed for c in validate(plan,sessions,interpretation)))
running_plan=EventPlan.model_validate(next(c['plan'] for c in cases if c['plan'].get('asOf')==810))
extension=Interpretation(kind='duration',targetId='build',minutes=25,description='Extend build')
repairs=[[s.model_dump(exclude_none=True) for s in sessions] for sessions in solve_demo(running_plan,extension)]
print(json.dumps({'checks':results,'ongoingRepairs':repairs}))
`;
const result = spawnSync(python, ['-c',program], {input:JSON.stringify(cases), encoding:'utf8'});
if (result.status !== 0) throw new Error(result.stderr || 'Python contract check failed. Install server/requirements.txt first.');
const {checks:pythonChecks, ongoingRepairs} = JSON.parse(result.stdout);
if (!ongoingRepairs.length || ongoingRepairs.some(sessions => !validateCandidate(ongoingPlan,sessions,extension).every(check => check.passed))) throw new Error('Python ongoing-extension repairs failed independent browser validation.');
const mismatches = cases.flatMap((entry,index) => {
  const browserPass = validateCandidate(entry.plan, entry.sessions, entry.interpretation).every(check => check.passed);
  return browserPass === pythonChecks[index] ? [] : [{name:entry.name, browser:browserPass, python:pythonChecks[index]}];
});
if (mismatches.length) {console.error(JSON.stringify(mismatches,null,2)); process.exit(1);}
console.log(`Browser and Python validators agree on ${cases.length} feasible and adversarial schedule cases.`);
