import type { CreateUser, Role, User } from '@logto/schemas';
import { RoleType } from '@logto/schemas';
import { pickDefault } from '@logto/shared/esm';
import { removeUndefinedKeys } from '@silverhand/essentials';

import { mockUser, mockUserList, mockUserListResponse } from '#src/__mocks__/index.js';
import { type InsertUserResult } from '#src/libraries/user.js';
import type Libraries from '#src/tenants/Libraries.js';
import type Queries from '#src/tenants/Queries.js';
import { MockTenant, type Partial2 } from '#src/test-utils/tenant.js';
import { createRequester } from '#src/utils/test-utils.js';

import { transpileUserProfileResponse } from '../../utils/user.js';

const { jest } = import.meta;

const filterUsersWithSearch = (users: User[], search: string) =>
  users.filter((user) =>
    [user.username, user.primaryEmail, user.primaryPhone, user.name].some((value) =>
      value ? !value.includes(search) : false
    )
  );

const mockIdentityUser: User = {
  ...mockUser,
  id: 'user_1',
  name: 'Alice',
  identities: {
    dingtalk: {
      userId: 'ding_123',
      details: {},
    },
  },
};

const findUserByIdentity = jest.fn(async (target: string, userId: string) =>
  target === 'dingtalk' && userId === 'ding_123' ? mockIdentityUser : null
);

const mockedQueries = {
  users: {
    countUsers: jest.fn(async ({ search }) => ({
      count: search
        ? filterUsersWithSearch(mockUserList, String(search)).length
        : mockUserList.length,
    })),
    findUsers: jest.fn(
      async (limit, offset, { search }): Promise<User[]> =>
        search ? filterUsersWithSearch(mockUserList, String(search)) : mockUserList
    ),
    findUserByIdentity,
  },
  roles: {
    findRolesByRoleNames: jest.fn(
      async (): Promise<Role[]> => [
        {
          tenantId: 'fake_tenant',
          id: 'role_id',
          name: 'admin',
          description: 'none',
          type: RoleType.User,
          isDefault: false,
        },
      ]
    ),
  },
  usersRoles: {
    deleteUsersRolesByUserIdAndRoleId: jest.fn(),
  },
} satisfies Partial2<Queries>;

const usersLibraries = {
  generateUserId: jest.fn(async () => 'fooId'),
  insertUser: jest.fn(
    async (user: CreateUser): Promise<InsertUserResult> => [
      {
        ...mockUser,
        ...removeUndefinedKeys(user), // No undefined values will be returned from database
      },
    ]
  ),
} satisfies Partial<Libraries['users']>;

const adminUserRoutes = await pickDefault(import('./search.js'));

describe('adminUserRoutes', () => {
  const tenantContext = new MockTenant(undefined, mockedQueries, undefined, {
    users: usersLibraries,
  });
  const userRequest = createRequester({ authedRoutes: adminUserRoutes, tenantContext });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('GET /users', async () => {
    const response = await userRequest.get('/users');
    expect(response.status).toEqual(200);
    expect(response.body).toEqual(mockUserListResponse);
    expect(response.header).toHaveProperty('total-number', `${mockUserList.length}`);
  });

  it('GET /users should not include passwordDigest/passwordAlgorithm by default', async () => {
    const response = await userRequest.get('/users');
    expect(response.status).toEqual(200);
    for (const user of response.body as unknown[]) {
      expect(user).not.toHaveProperty('passwordDigest');
      expect(user).not.toHaveProperty('passwordAlgorithm');
    }
  });

  it('GET /users with includePasswordHash=true should include passwordDigest and passwordAlgorithm for each user', async () => {
    const response = await userRequest.get('/users?includePasswordHash=true');
    expect(response.status).toEqual(200);
    expect(response.body).toHaveLength(mockUserList.length);
    for (const [index, user] of (response.body as unknown[]).entries()) {
      expect(user).toHaveProperty('passwordDigest', mockUserList[index]!.passwordEncrypted);
      expect(user).toHaveProperty(
        'passwordAlgorithm',
        mockUserList[index]!.passwordEncryptionMethod
      );
    }
  });

  it('GET /users should return matched data', async () => {
    const search = 'foo';
    const response = await userRequest.get('/users').send({ search });
    expect(response.status).toEqual(200);
    expect(response.body).toEqual(
      filterUsersWithSearch(mockUserList, search).map((user) => transpileUserProfileResponse(user))
    );
    expect(response.header).toHaveProperty(
      'total-number',
      `${filterUsersWithSearch(mockUserList, search).length}`
    );
  });

  describe('GET /users by social identity', () => {
    it('should return the matched user', async () => {
      const response = await userRequest.get(
        '/users?identityTarget=dingtalk&identityUserId=ding_123'
      );

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].id).toBe('user_1');
      expect(response.body[0].identities).toEqual({
        dingtalk: {
          userId: 'ding_123',
          details: {},
        },
      });
      expect(response.header).toHaveProperty('total-number', '1');
      expect(findUserByIdentity).toHaveBeenCalledWith('dingtalk', 'ding_123');
      expect(mockedQueries.users.findUsers).not.toHaveBeenCalled();
    });

    it('should return an empty array when no user is linked', async () => {
      const response = await userRequest.get(
        '/users?identityTarget=dingtalk&identityUserId=unknown'
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
      expect(response.header).toHaveProperty('total-number', '0');
      expect(findUserByIdentity).toHaveBeenCalledWith('dingtalk', 'unknown');
    });

    it('should return 400 when only identityTarget is provided', async () => {
      const response = await userRequest.get('/users?identityTarget=dingtalk');

      expect(response.status).toBe(400);
      expect(findUserByIdentity).not.toHaveBeenCalled();
    });

    it('should return 400 when only identityUserId is provided', async () => {
      const response = await userRequest.get('/users?identityUserId=ding_123');

      expect(response.status).toBe(400);
      expect(findUserByIdentity).not.toHaveBeenCalled();
    });

    it('should return 400 when identity lookup is combined with excludeRoleId', async () => {
      const response = await userRequest.get(
        '/users?identityTarget=dingtalk&identityUserId=ding_123&excludeRoleId=role_1'
      );

      expect(response.status).toBe(400);
      expect(findUserByIdentity).not.toHaveBeenCalled();
    });

    it('should return 400 when identity lookup is combined with search filters', async () => {
      const response = await userRequest.get(
        '/users?identityTarget=dingtalk&identityUserId=ding_123&search.username=alice'
      );

      expect(response.status).toBe(400);
      expect(findUserByIdentity).not.toHaveBeenCalled();
    });
  });
});
