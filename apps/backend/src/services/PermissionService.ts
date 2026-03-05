import { BaseService, Get } from "bunsane/service";
import { type PermissionManifest } from '@qyubit/sedjiwa-permissions';
import { TASK_PERMISSIONS } from '~/utils/auth';

export class PermissionRestService extends BaseService {
    constructor() {
        super();
    }

    @Get("/.well-known/permissions")
    async getPermissions(): Promise<Response> {
        const manifest: PermissionManifest = {
            app: "task-management",
            version: "1.0.0",
            permissions: TASK_PERMISSIONS,
        };
        return Response.json(manifest);
    }
}
