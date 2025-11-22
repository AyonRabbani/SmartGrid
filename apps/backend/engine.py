import sys, json

for line in sys.stdin:
    msg = json.loads(line)

    response = {
        "id": msg.get('id'),
        "result": f"received {msg.get('task')}"
    }

    print(json.dumps(response), flush=True)
