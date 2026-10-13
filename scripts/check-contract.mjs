// Exercise the browser's real outputs against the independent Python validator.
// No API requests, model calls, or credentials are involved.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { SAMPLE_PLAN, clonePlan } from '../src/lib/data.ts';
import { repairPlan, validateCandidate } from '../src/lib/planner.ts';

const baseline = {kind:'unknown', targetId:null, minutes:0, description:'Baseline contract check'};
const cases = [];
for (const [disruption, asOf] of [
  ['Maya is 40 minutes late', 540],
  ['Workshop Studio is unavailable', 540],
  ['The build session needs 25 more minutes', 540],
  ['Workshop Studio is unavailable', 790],
  ['showcase is 10 minutes late', 540],
]) {
  const plan = {...clonePlan(SAMPLE_PLAN), asOf};
  const result = repairPlan(plan, disruption);
  if (!result.options.length) throw new Error(`Expected feasible contract fixture: ${disruption}`);
  for (const option of result.options) cases.push({name:`${disruption} / ${asOf} / ${option.id}`, plan, sessions:option.sessions, interpretation:result.interpretation});
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
results=[]
for case in json.load(sys.stdin):
    plan=EventPlan.model_validate(case['plan'])
    sessions=[Session.model_validate(s) for s in case['sessions']]
    interpretation=None if case['interpretation']['kind']=='unknown' else Interpretation.model_validate(case['interpretation'])
    results.append(all(c.passed for c in validate(plan,sessions,interpretation)))
print(json.dumps(results))
`;
const result = spawnSync(python, ['-c',program], {input:JSON.stringify(cases), encoding:'utf8'});
if (result.status !== 0) throw new Error(result.stderr || 'Python contract check failed. Install server/requirements.txt first.');
const pythonChecks = JSON.parse(result.stdout);
const mismatches = cases.flatMap((entry,index) => {
  const browserPass = validateCandidate(entry.plan, entry.sessions, entry.interpretation).every(check => check.passed);
  return browserPass === pythonChecks[index] ? [] : [{name:entry.name, browser:browserPass, python:pythonChecks[index]}];
});
if (mismatches.length) {console.error(JSON.stringify(mismatches,null,2)); process.exit(1);}
console.log(`Browser and Python validators agree on ${cases.length} feasible and adversarial schedule cases.`);
