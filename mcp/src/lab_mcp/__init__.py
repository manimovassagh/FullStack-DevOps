"""MCP servers for the Plant Parent cloud lab.

- lab_mcp.learn:   read-only. The blueprint as resources, tools and prompts (stages, lessons, concepts, search).
- lab_mcp.operate: acts on the local lab through Mission Control's HTTP API, with guardrails.
- lab_mcp.common:  settings and the file-access guard, the only thing the two share.

learn and operate never import each other: a learner process contains no code that can act on the lab.
"""
__version__ = "0.1.0"
