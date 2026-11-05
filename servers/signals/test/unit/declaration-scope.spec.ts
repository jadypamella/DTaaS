import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { Logger } from '@nestjs/common';
import AccessService from 'src/authz/access.service';
import GitLabTwinPolicy from 'src/authz/gitlab-twin.policy';
import TwinReader from 'src/authz/twin-reader';
import type { ConfigValues } from 'src/config/schema';
import testConfig from 'test/helpers/config';
import FakeGitLabClient from 'test/helpers/fake-gitlab-client';
import { visualisationOf } from 'test/helpers/twins';

// Carol is not the owner: GitLab lets her read Alice's project, as a member.
const CAROL = { id: 9, username: 'carol', token: 'token-c' };
const ALICE_PROJECT = {
  id: 10,
  path: 'alice',
  path_with_namespace: 'DTaaS/alice',
};
const TWIN_FILE = /files\/digital_twins%2F([^%]+)%2Fvisualisation\.json\/raw/;

// Alice's project, holding one folder per twin with its visualisation.json.
function projectWith(twins: Record<string, unknown>): FakeGitLabClient {
  return new FakeGitLabClient([
    [/groups\/DTaaS\/projects/, () => [ALICE_PROJECT]],
    [/repository\/branches\/master$/, () => ({ commit: { id: 's1' } })],
    [
      /repository\/tree/,
      () => Object.keys(twins).map((name) => ({ name, type: 'tree' })),
    ],
    [TWIN_FILE, (resource) => twins[resource.match(TWIN_FILE)?.[1] ?? '']],
  ]);
}

function policyOf(
  gitlab: FakeGitLabClient,
  overrides: Partial<ConfigValues> = {},
) {
  const config = testConfig(overrides);
  return new GitLabTwinPolicy(
    config,
    gitlab.asClient(),
    new TwinReader(config, gitlab.asClient()),
  );
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('The scope of a grant', () => {
  it('grants a whole GitLab project and not one twin: a reader of the project gets the signals of both its twins', async () => {
    const gitlab = projectWith({
      pump: visualisationOf(['alice/pump/flow']),
      boiler: visualisationOf(['alice/boiler/temperature']),
    });
    const access = new AccessService(policyOf(gitlab));
    const decision = await access.decide(CAROL, 'stream', [
      'alice/pump/flow',
      'alice/boiler/temperature',
    ]);
    expect(decision.refused).toEqual([]);
    expect(decision.allowed.map(({ twin, owner }) => [twin, owner])).toEqual([
      ['pump', 'alice'],
      ['boiler', 'alice'],
    ]);
  });
});

describe("A declaration that names another owner's namespace", () => {
  it("binds a topic only in the vhost of the project's owner, whatever the URL or the topic names", async () => {
    const forged = {
      schemaVersion: '1.0',
      transports: [
        { adapter: 'mqtt', url: 'mqtt://broker:1883/bob', topics: ['bob/x'] },
      ],
    };
    const policy = policyOf(projectWith({ pump: forged }), {
      'vhost-template': 'dtaas-{owner}',
    });
    const targets = await policy.listResources(CAROL, 'stream');
    expect(targets).toEqual([
      expect.objectContaining({ path: 'bob/x', vhost: 'dtaas-alice' }),
    ]);
  });

  it("refuses an InfluxDB org or bucket of another owner under the configured templates, and keeps the owner's own", async () => {
    const twinWith = (org: string, bucket: string) =>
      visualisationOf([`alice/${org}/${bucket}`], { org, bucket });
    const gitlab = projectWith({
      otherOrg: twinWith('org-bob', 'bucket-alice'),
      otherBucket: twinWith('org-alice', 'bucket-bob'),
      own: twinWith('org-alice', 'bucket-alice'),
    });
    const policy = policyOf(gitlab, {
      'influx-org-template': 'org-{owner}',
      'influx-bucket-template': 'bucket-{owner}',
    });
    const targets = await policy.listResources(CAROL, 'range');
    expect(targets.map(({ twin, influx }) => [twin, influx])).toEqual([
      ['otherOrg', undefined],
      ['otherBucket', undefined],
      ['own', { org: 'org-alice', bucket: 'bucket-alice' }],
    ]);
  });
});
