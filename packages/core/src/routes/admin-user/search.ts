import { OrganizationUserRelations, UsersRoles } from '@logto/schemas';
import { type Nullable, tryThat, yes } from '@silverhand/essentials';

import RequestError from '#src/errors/RequestError/index.js';
import koaGuard from '#src/middleware/koa-guard.js';
import koaPagination from '#src/middleware/koa-pagination.js';
import { type UserConditions } from '#src/queries/user.js';
import { parseSearchParamsForSearch } from '#src/utils/search.js';

import {
  adminUserProfileResponseGuard,
  transpileAdminUserProfileResponse,
} from '../../utils/user.js';
import type { ManagementApiRouter, RouterInitArgs } from '../types.js';

const getQueryRelation = (
  excludeRoleId: Nullable<string>,
  excludeOrganizationId: Nullable<string>
): UserConditions['relation'] => {
  if (excludeRoleId) {
    return {
      table: UsersRoles.table,
      field: UsersRoles.fields.roleId,
      value: excludeRoleId,
      type: 'not exists',
    };
  }

  if (excludeOrganizationId) {
    return {
      table: OrganizationUserRelations.table,
      field: OrganizationUserRelations.fields.organizationId,
      value: excludeOrganizationId,
      type: 'not exists',
    };
  }

  return undefined;
};

const getIdentityLookupParams = (
  searchParams: URLSearchParams
): { identityTarget: string; identityUserId: string } | undefined => {
  const identityTarget = searchParams.get('identityTarget');
  const identityUserId = searchParams.get('identityUserId');

  if (Boolean(identityTarget) !== Boolean(identityUserId)) {
    throw new RequestError({
      code: 'request.invalid_input',
      status: 400,
      details: '`identityTarget` and `identityUserId` must be provided together.',
    });
  }

  if (!(identityTarget && identityUserId)) {
    return;
  }

  const excludeRoleId = searchParams.get('excludeRoleId');
  const excludeOrganizationId = searchParams.get('excludeOrganizationId');
  const hasOtherFilters =
    Boolean(excludeRoleId) ||
    Boolean(excludeOrganizationId) ||
    [...searchParams.keys()].some((key) => key.startsWith('search.'));

  if (hasOtherFilters) {
    throw new RequestError({
      code: 'request.invalid_input',
      status: 400,
      details: 'Identity lookup cannot be combined with other user search filters.',
    });
  }

  return { identityTarget, identityUserId };
};

export default function adminUserSearchRoutes<T extends ManagementApiRouter>(
  ...[router, { queries }]: RouterInitArgs<T>
) {
  const {
    users: { findUsers, countUsers, findUserByIdentity },
  } = queries;

  router.get(
    '/users',
    koaPagination(),
    koaGuard({
      response: adminUserProfileResponseGuard.array(),
      status: [200, 400],
    }),
    async (ctx, next) => {
      const { limit, offset } = ctx.pagination;
      const { searchParams } = ctx.request.URL;

      return tryThat(
        async () => {
          const identityLookup = getIdentityLookupParams(searchParams);
          const includePasswordHash = yes(searchParams.get('includePasswordHash') ?? '');

          if (identityLookup) {
            const user = await findUserByIdentity(
              identityLookup.identityTarget,
              identityLookup.identityUserId
            );

            ctx.pagination.totalCount = user ? 1 : 0;
            ctx.body = user
              ? [transpileAdminUserProfileResponse(user, { includePasswordHash })]
              : [];

            return next();
          }

          const excludeRoleId = searchParams.get('excludeRoleId');
          const excludeOrganizationId = searchParams.get('excludeOrganizationId');

          if (excludeRoleId && excludeOrganizationId) {
            throw new RequestError({
              code: 'request.invalid_input',
              status: 400,
              details:
                'Parameter `excludeRoleId` and `excludeOrganizationId` cannot be used at the same time.',
            });
          }

          const conditions: UserConditions = {
            search: parseSearchParamsForSearch(searchParams),
            relation: getQueryRelation(excludeRoleId, excludeOrganizationId),
          };

          const [{ count }, users] = await Promise.all([
            countUsers(conditions),
            findUsers(limit, offset, conditions),
          ]);

          ctx.pagination.totalCount = count;
          ctx.body = users.map((user) =>
            transpileAdminUserProfileResponse(user, { includePasswordHash })
          );

          return next();
        },
        (error) => {
          if (error instanceof TypeError) {
            throw new RequestError(
              { code: 'request.invalid_input', details: error.message },
              error
            );
          }
          throw error;
        }
      );
    }
  );
}
