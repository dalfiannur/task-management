import { BaseService, Get } from "bunsane/service";
import { type PermissionManifest, TASKS_PERMISSIONS } from '@qyubit/sedjiwa-permissions';

export class PermissionRestService extends BaseService {
    constructor() {
        super();
    }

    @Get("/.well-known/permissions")
    async getPermissions(): Promise<Response> {
        const manifest: PermissionManifest = {
            app: "task-management",
            version: "1.0.0",
            permissions: TASKS_PERMISSIONS,
        };
        return Response.json(manifest);
    }
}
