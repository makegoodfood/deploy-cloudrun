/*
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { test } from 'node:test';
import assert from 'node:assert';

import { getExecOutput } from '@actions/exec';
import { run_v1 } from 'googleapis';
import yaml from 'js-yaml';

import { skipIfMissingEnv } from '@google-github-actions/actions-utils';

test(
  'e2e tests',
  {
    concurrency: true,
    skip: skipIfMissingEnv('PROJECT_ID', 'SERVICE'),
  },
  async (suite) => {
    let service: run_v1.Schema$Service;

    suite.before(async () => {
      const args = [
        'run',
        'services',
        'describe',
        process.env.SERVICE!,
        '--project',
        process.env.PROJECT_ID!,
        '--format',
        'yaml',
        '--platform',
        'managed',
        '--region',
        'us-central1',
      ];

      const output = await getExecOutput('gcloud', args);
      service = yaml.load(output.stdout) as run_v1.Schema$Service;

      if (!service) {
        throw new Error('failed to find service definition');
      }
    });

    await suite.test('has the correct envvars', { skip: skipIfMissingEnv('ENV') }, async () => {
      const expected = parseEnvVars(process.env.ENV!);
      const actual = service?.spec?.template?.spec?.containers?.at(0)?.env?.filter((e) => e?.value);

      const subset = expected.map((e) => {
        return actual?.find((a) => a.name == e.name);
      });

      assert.deepStrictEqual(subset, expected);
    });

    await suite.test(
      'has the correct secret vars',
      { skip: skipIfMissingEnv('SECRET_ENV') },
      async () => {
        const expected = parseEnvVars(process.env.SECRET_ENV!);
        const actual = service?.spec?.template?.spec?.containers
          ?.at(0)
          ?.env?.filter((entry) => entry && entry.valueFrom)
          .map((entry) => {
            const ref = entry.valueFrom?.secretKeyRef;
            return { name: entry.name, value: `${ref?.name}:${ref?.key}` };
          });

        const subset = expected.map((e) => {
          return actual?.find((a) => a.name == e.name);
        });

        assert.deepStrictEqual(subset, expected);
      },
    );

    await suite.test(
      'has the correct secret volumes',
      { skip: skipIfMissingEnv('SECRET_VOLUME') },
      async () => {
        const expected = parseEnvVars(process.env.SECRET_VOLUMES!);
        const actual = service?.spec?.template?.spec?.containers
          ?.at(0)
          ?.volumeMounts?.map((volumeMount) => {
            const secretVolume = service?.spec?.template?.spec?.volumes?.find(
              (volume) => volumeMount.name === volume.name,
            )?.secret;
            const secretName = secretVolume?.secretName;
            const secretData = secretVolume?.items?.at(0);
            const secretPath = `${volumeMount.mountPath}/${secretData?.path}`;
            const secretRef = `${secretName}:${secretData?.key}`;
            return { name: secretPath, value: secretRef };
          });

        const subset = expected.map((e) => {
          return actual?.find((a) => a.name == e.name);
        });

        assert.deepStrictEqual(subset, expected);
      },
    );

    await suite.test('has the correct params', { skip: skipIfMissingEnv('PARAMS') }, async () => {
      const expected = JSON.parse(process.env.PARAMS!);
      const actual = service?.spec?.template?.spec;

      if (expected.containerConncurrency) {
        assert.deepStrictEqual(actual?.containerConcurrency, expected.containerConncurrency);
      }

      if (expected.timeoutSeconds) {
        assert.deepStrictEqual(actual?.timeoutSeconds, expected.timeoutSeconds);
      }

      const limits = actual?.containers?.at(0)?.resources?.limits;
      if (expected.cpu) {
        assert.deepStrictEqual(limits?.cpu, expected.cpu.toString());
      }

      if (expected.memory) {
        assert.deepStrictEqual(limits?.memory, expected.memory);
      }
    });

    await suite.test(
      'has the correct annotations',
      { skip: skipIfMissingEnv('ANNOTATIONS') },
      async () => {
        const expected = JSON.parse(process.env.ANNOTATIONS!) as Record<string, string>;
        const actual = service?.spec?.template?.metadata?.annotations;

        const subset = Object.assign(
          {},
          ...Object.keys(expected).map((k) => ({ [k]: actual?.[k] })),
        );

        assert.deepStrictEqual(subset, expected);
      },
    );

    await suite.test('has the correct labels', { skip: skipIfMissingEnv('LABELS') }, async () => {
      const expected = JSON.parse(process.env.LABELS!) as Record<string, string>;
      const actual = service?.spec?.template?.metadata?.labels;

      const subset = Object.assign({}, ...Object.keys(expected).map((k) => ({ [k]: actual?.[k] })));

      assert.deepStrictEqual(subset, expected);
    });

    await suite.test('has the revision name', { skip: skipIfMissingEnv('REVISION') }, async () => {
      const expected = process.env.REVISION! as string;
      const actual = service?.spec?.template?.metadata?.name;
      assert.deepStrictEqual(actual, expected);
    });

    await suite.test('has the correct tag', { skip: skipIfMissingEnv('TAG') }, async () => {
      const expected = process.env.TAG!;
      const actual = service?.spec?.traffic?.map((revision) => revision.tag);
      assert.deepStrictEqual(actual, expected);
    });

    await suite.test(
      'has the correct traffic',
      { skip: skipIfMissingEnv('TRAFFIC', 'TAG') },
      async () => {
        const expected = process.env.TRAFFIC!;
        const tagged = service?.spec?.traffic?.find((revision) => {
          return revision.tag == process.env.TAG!;
        });
        const percent = tagged?.percent;
        assert.deepStrictEqual(percent, expected);
      },
    );
  },
);

const parseEnvVars = (envVarInput: string): run_v1.Schema$EnvVar[] => {
  const envVarList = envVarInput.split(',');
  const envVars = envVarList.map((envVar) => {
    if (!envVar.includes('=')) {
      throw new TypeError(
        `Env Vars must be in "KEY1=VALUE1,KEY2=VALUE2" format, received ${envVar}`,
      );
    }
    const keyValue = envVar.split('=');
    return { name: keyValue[0], value: keyValue[1] };
  });

  return envVars;
};
