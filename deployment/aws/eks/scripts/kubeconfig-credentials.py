"""Pin the `aws eks get-token` exec plugin in a kubeconfig to the kubectl IAM user's key.

kubectl runs `aws eks get-token` on every call; this makes it sign with the
access key from Terraform output instead of whatever is in the shell.
Usage: terraform output -json kubectl_access_key | kubeconfig-credentials.py <kubeconfig>
"""
import json
import sys

path = sys.argv[1]
key = json.load(sys.stdin)
lines = open(path).read().splitlines()
out = []
for line in lines:
    out.append(line)
    if line.strip() == "command: aws":
        indent = line[: len(line) - len(line.lstrip())]
        out += [
            f"{indent}env:",
            f"{indent}- name: AWS_ACCESS_KEY_ID",
            f"{indent}  value: {key['id']}",
            f"{indent}- name: AWS_SECRET_ACCESS_KEY",
            f"{indent}  value: {key['secret']}",
            f"{indent}- name: AWS_SESSION_TOKEN",
            f'{indent}  value: ""',
        ]
open(path, "w").write("\n".join(out) + "\n")
