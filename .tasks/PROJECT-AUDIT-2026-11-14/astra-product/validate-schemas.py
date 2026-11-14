import json
from pathlib import Path
from jsonschema import Draft202012Validator
base = Path('.tasks/PROJECT-AUDIT-2026-11-14/astra-product')
schemas=json.loads(Path('.tasks/TASK-007-T2-FT-003-W5/official-schemas.json').read_text())
observations=json.loads((base/'models/model-observations.json').read_text())
results=[]
for record in observations['inputs']:
 endpoint=record['endpoint'];document=schemas[endpoint]['schema']
 schema=document['paths']['/'+endpoint]['post']['requestBody']['content']['application/json']['schema']
 errors=list(Draft202012Validator({**schema,'components':document['components']}).iter_errors(record['input']))
 assert not errors,(endpoint,[e.message for e in errors])
 resolved=document
 for key in schema['$ref'].removeprefix('#/').split('/'): resolved=resolved[key]
 assert set(record['input'])<=set(resolved['properties']),endpoint
 results.append({'endpoint':endpoint,'result':'PASS','source':schemas[endpoint]['source']})
assert len({r['endpoint'] for r in results})==10
(base/'schema-validation.json').write_text(json.dumps(results,indent=2)+'\n')
print(f'PASS: {len(results)} fresh payloads across 10 endpoints; schema source is saved official snapshot, no live inference.')
