import { spawnSync } from 'node:child_process';

const docker = process.platform === 'win32' ? 'docker.exe' : 'docker';
const npmCli = process.env.npm_execpath;
const localTestDatabaseUrl =
  'postgresql://dartech:dartech@localhost:5433/dartech_os_test?schema=public';

function run(command, args, environment = process.env) {
  process.stdout.write(`\n> ${command} ${args.join(' ')}\n`);
  const result = spawnSync(command, args, {
    env: environment,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runNpm(args, environment) {
  if (!npmCli) {
    throw new Error('npm_execpath is required to run the quality gate');
  }
  run(process.execPath, [npmCli, ...args], environment);
}

if (process.env.CI !== 'true') {
  run(docker, ['compose', 'up', '-d', '--wait', 'postgres']);
}

const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? localTestDatabaseUrl;
const gateEnvironment = {
  ...process.env,
  APP_ENV: 'test',
  DATABASE_URL: testDatabaseUrl,
  MIGRATION_DATABASE_URL: testDatabaseUrl,
  NODE_ENV: 'test',
  TEST_DATABASE_URL: testDatabaseUrl,
};

runNpm(['ci'], gateEnvironment);
runNpm(['run', 'lint'], gateEnvironment);
runNpm(['run', 'db:generate'], gateEnvironment);
runNpm(['run', 'db:validate'], gateEnvironment);
runNpm(['run', 'db:migrate:deploy'], gateEnvironment);
runNpm(['run', 'db:migrate:status'], gateEnvironment);
runNpm(['run', 'db:migrate:validate'], gateEnvironment);
runNpm(['run', 'typecheck'], gateEnvironment);
runNpm(['run', 'test:unit'], gateEnvironment);
runNpm(['run', 'test:integration'], gateEnvironment);
runNpm(['run', 'build'], gateEnvironment);
run(docker, ['compose', 'config', '--quiet'], gateEnvironment);
