import { BaseService, Get } from "bunsane/service";
import { type PermissionManifest, TASK_PERMISSIONS } from '@qyubit/sedjiwa-permissions';

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
