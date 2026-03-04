import { BaseService, Get } from "bunsane/service";
import { Action, PermissionManifest } from '@qyubit/sedjiwa-permissions';

export class PermissionRestService extends BaseService {
    constructor() {
        super();
    }

    @Get("/.well-known/permissions")
    async getPermissions(): Promise<Response> {
        const manifest: PermissionManifest = {
            app: "task-management",
            version: "1.0.0",
            permissions: [
                { resource: "task_management:tasks", action: Action.Create, description: "Create tasks" },
                { resource: "task_management:tasks", action: Action.Read, description: "Read tasks" },
                { resource: "task_management:tasks", action: Action.Update, description: "Update tasks" },
                { resource: "task_management:tasks", action: Action.Delete, description: "Delete tasks" },
                { resource: "task_management:tasks", action: Action.Manage, description: "Manage tasks" },
                { resource: "task_management:projects", action: Action.Create, description: "Create projects" },
                { resource: "task_management:projects", action: Action.Read, description: "Read projects" },
                { resource: "task_management:projects", action: Action.Update, description: "Update projects" },
                { resource: "task_management:projects", action: Action.Delete, description: "Delete projects" },
                { resource: "task_management:projects", action: Action.Manage, description: "Manage projects" },
                { resource: "task_management:modules", action: Action.Create, description: "Create modules" },
                { resource: "task_management:modules", action: Action.Read, description: "Read modules" },
                { resource: "task_management:modules", action: Action.Update, description: "Update modules" },
                { resource: "task_management:modules", action: Action.Delete, description: "Delete modules" },
                { resource: "task_management:modules", action: Action.Manage, description: "Manage modules" },
                { resource: "task_management:labels", action: Action.Create, description: "Create labels" },
                { resource: "task_management:labels", action: Action.Read, description: "Read labels" },
                { resource: "task_management:labels", action: Action.Update, description: "Update labels" },
                { resource: "task_management:labels", action: Action.Delete, description: "Delete labels" },
                { resource: "task_management:labels", action: Action.Manage, description: "Manage labels" },
                { resource: "task_management:users", action: Action.Create, description: "Create users" },
                { resource: "task_management:users", action: Action.Read, description: "Read users" },
                { resource: "task_management:users", action: Action.Update, description: "Update users" },
                { resource: "task_management:users", action: Action.Delete, description: "Delete users" },
                { resource: "task_management:users", action: Action.Manage, description: "Manage users" },
                { resource: "task_management:media", action: Action.Create, description: "Create media" },
                { resource: "task_management:media", action: Action.Read, description: "Read media" },
                { resource: "task_management:media", action: Action.Update, description: "Update media" },
                { resource: "task_management:media", action: Action.Delete, description: "Delete media" },
                { resource: "task_management:media", action: Action.Manage, description: "Manage media" },
                { resource: "task_management:comments", action: Action.Create, description: "Create comments" },
                { resource: "task_management:comments", action: Action.Read, description: "Read comments" },
                { resource: "task_management:comments", action: Action.Update, description: "Update comments" },
                { resource: "task_management:comments", action: Action.Delete, description: "Delete comments" },
                { resource: "task_management:comments", action: Action.Manage, description: "Manage comments" },
                { resource: "task_management:notifications", action: Action.Create, description: "Create notifications" },
                { resource: "task_management:notifications", action: Action.Read, description: "Read notifications" },
                { resource: "task_management:notifications", action: Action.Update, description: "Update notifications" },
                { resource: "task_management:notifications", action: Action.Delete, description: "Delete notifications" },
                { resource: "task_management:notifications", action: Action.Manage, description: "Manage notifications" },
                { resource: "task_management:activities", action: Action.Create, description: "Create activities" },
                { resource: "task_management:activities", action: Action.Read, description: "Read activities" },
                { resource: "task_management:activities", action: Action.Update, description: "Update activities" },
                { resource: "task_management:activities", action: Action.Delete, description: "Delete activities" },
                { resource: "task_management:activities", action: Action.Manage, description: "Manage activities" },
                { resource: "task_management:pages", action: Action.Create, description: "Create pages" },
                { resource: "task_management:pages", action: Action.Read, description: "Read pages" },
                { resource: "task_management:pages", action: Action.Update, description: "Update pages" },
                { resource: "task_management:pages", action: Action.Delete, description: "Delete pages" },
                { resource: "task_management:pages", action: Action.Manage, description: "Manage pages" },
                { resource: "task_management:memberships", action: Action.Create, description: "Create memberships" },
                { resource: "task_management:memberships", action: Action.Read, description: "Read memberships" },
                { resource: "task_management:memberships", action: Action.Update, description: "Update memberships" },
                { resource: "task_management:memberships", action: Action.Delete, description: "Delete memberships" },
                { resource: "task_management:memberships", action: Action.Manage, description: "Manage memberships" },
            ],
        };

        return Response.json(manifest);
    }
}