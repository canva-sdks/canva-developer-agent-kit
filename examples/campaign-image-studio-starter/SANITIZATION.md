# Sanitization scope

This archive contains allowlisted, Git-tracked source/configuration only, plus
new setup instructions and empty environment-variable fields.

Excluded: original .replit/userenv settings, Git history, database data,
browser storage, agent memory, conversation files, local tools/caches,
dependencies, build output, logs, uploads, and the design mockup sandbox.
The production Canva callback was removed from the exported API manifest.
Artifact IDs were made portable. No live files or credentials were changed.
Tests retain explicitly synthetic credentials and mocked tokens.

The export checks its contents for original Replit hostnames, obvious embedded
credentials/private keys, and unexpected Canva configuration assignments.
It does not retrieve or compare live secret values and is not a comprehensive
security audit. The exported credentials example has only empty values.
Recipients need their own credentials, callback registration, and database.
