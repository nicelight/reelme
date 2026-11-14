"""Run: uv run --with jsonschema==4.26.0 .tasks/TASK-007-T2-FT-003-W5/validate-schemas.py.
Validates recorded worker payloads against the downloaded public fal OpenAPI;
no inference calls. Explicitly rejects keys absent from that input schema.
"""
import json
from pathlib import Path
from jsonschema import Draft202012Validator
root = Path(__file__).parent
schemas = json.loads((root / 'official-schemas.json').read_text())
observations = json.loads((root / 'model-observations.json').read_text())
results = []
for record in observations['inputs']:
    endpoint = record['endpoint']
    document = schemas[endpoint]['schema']
    route = document['paths']['/' + endpoint]['post']
    schema = route['requestBody']['content']['application/json']['schema']
    validator = Draft202012Validator({**schema, 'components': document['components']})
    errors = sorted(validator.iter_errors(record['input']), key=lambda error: str(error.path))
    assert not errors, (endpoint, [error.message for error in errors])
    input_schema = document
    for key in schema['$ref'].removeprefix('#/').split('/'):
        input_schema = input_schema[key]
    assert set(record['input']) <= set(input_schema['properties']), endpoint
    results.append({'endpoint': endpoint, 'sessionId': record['sessionId'], 'result': 'PASS'})
assert len({result['endpoint'] for result in results}) == 10
(root / 'schema-validation.json').write_text(json.dumps(results, indent=2) + '\n')
print(f'PASS: {len(results)} saved payloads, all 10 endpoints; required fields/types/enums/ranges/nested refs and declared input keys.')
