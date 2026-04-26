1. **Update `docker-compose.yml` environment variables**
   - Apply the `${VAR:-default}` pattern for all environment variables as per system rules.
   - Include missing configuration parameters (`CHROME_EXECUTABLE_PATH`, cache TTLs, `DEFAULT_ACCOUNT_ID`).
   - Specifically use `${API_KEY-tu_contraseña_super_segura_aqui}` to allow passing an empty string when disabling authentication explicitly.

2. **Update Documentation (`README.md` and `OPERATIONS_RUNBOOK.md`)**
   - Clarify the behavior of `API_KEY` and how setting it to an empty string explicitly disables API authentication, noting the warning it will produce.

3. **Verify backend configurations and tests**
   - Run backend tests to ensure the AI configuration validation and diagnostic endpoints are still functioning as expected.

4. **Complete pre-commit checks**
   - Follow `pre_commit_instructions` to ensure proper testing, verifications, review, and reflections are performed.

5. **Submit changes**
   - Commit the changes and invoke the submit tool to finalize.
