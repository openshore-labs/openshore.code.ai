// The environment a child shell starts with. OpenShore's own process can hold
// keys (the person launched it from a terminal with a provider key exported,
// or an older build wrote one into process.env), and every shell it spawns,
// the terminal's and the agent's runShell alike, used to inherit all of it.
// A command the model wrote could then read the key and print or send it.
// So a child gets the same environment minus anything that looks like a
// secret. It is a denylist on purpose: toolchains read dozens of variables
// (JAVA_HOME, NVM_DIR, GOPATH, PYENV_ROOT), and an allowlist would break
// builds in ways a person cannot diagnose. PATH, HOME, LANG, TERM, the
// locale and display variables, and SSH_AUTH_SOCK (git over ssh) all pass.
//
// An interactive terminal still sources the person's own shell files, so a
// key they export there comes back in that shell; that is their choice, made
// in their own files. What this removes is only what OpenShore carried in.

/** A variable name that carries a credential by convention: a trailing key,
 *  token, secret, password or credentials word, with or without a provider
 *  prefix (OPENAI_API_KEY, GH_TOKEN, AWS_SECRET_ACCESS_KEY, NPM_TOKEN). */
const SECRET_NAME =
  /(?:^|_)(?:API_?KEY|ACCESS_?KEY|SECRET_?KEY|PRIVATE_?KEY|KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?)$/i;

/** Known credential variables the naming rule does not catch. */
const KNOWN_SECRETS = new Set(['PGPASSWORD', 'MYSQL_PWD']);

/** True when a variable of this name is dropped from a child's environment. */
export function isSecretEnvName(name: string): boolean {
  return SECRET_NAME.test(name) || KNOWN_SECRETS.has(name.toUpperCase());
}

/**
 * A copy of `env` with every secret-looking variable removed. `keep` names
 * variables a caller needs to pass through anyway (a paired coding CLI's own
 * key), matched exactly. The input is never modified.
 */
export function scrubbedEnv(
  env: NodeJS.ProcessEnv = process.env,
  keep: readonly string[] = [],
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (isSecretEnvName(name) && !keep.includes(name)) continue;
    out[name] = value;
  }
  return out;
}
