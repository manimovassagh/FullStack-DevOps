Help me add a new deployment stage to the Plant Parent cloud lab.

- Name: `{name}`
- Cloud: {cloud}
- Shape: {shape}

Follow the blueprint's rules (`blueprint://rules`), grounded in the repository:

1. Find the closest existing stage with `learning_path`, `find_example` and `search_blueprint`, and say which one to copy beside (never modify old stages).
2. List the ports, names and registry ranges already used (`list_stages`) and propose ones that do not collide.
3. Give the file list for the new stage folder, what differs from the stage it is copied from (use `compare_stages` on a similar pair as a model), and which README sections it needs (including the "What each file teaches" table and FLOCI-NOTES.md).
4. Give the pipeline: which workflow to copy, which smoke tests it must run, and how to verify it on local CI one pipeline at a time.
5. Name what to register in Mission Control, and what to mark as a known simplification.
Cite `path:line` for every pointer.
