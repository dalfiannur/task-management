import "reflect-metadata";
import App from "bunsane/core/App";
import { ServiceRegistry } from "bunsane/service";

// Import components to trigger decorator registration
import "./components/TaskInfo";
import "./components/TaskAssignment";
import "./components/TaskLabels";
import "./components/LabelInfo";
import "./components/ProjectComponents";
import "./components/ModuleComponents";
import "./components/UserProfile";
import "./components/MediaFileInfo";
import "./components/CommentInfo";
import "./components/NotificationInfo";
import "./components/ActivityInfo";
import "./components/PageInfo";
import "./components/ProjectMembership";

import TaskService from "./services/TaskService";
import ProjectService from "./services/ProjectService";
import LabelService from "./services/LabelService";
import ModuleService from "./services/ModuleService";
import UserService from "./services/UserService";
import MediaService from "./services/MediaService";
import CommentService from "./services/CommentService";
import NotificationService from "./services/NotificationService";
import ActivityService from "./services/ActivityService";
import PageService from "./services/PageService";
import MembershipService from "./services/MembershipService";
import { AuthPlugin } from "./plugins/AuthPlugin";
import { S3StorageProvider } from "./storage/S3StorageProvider";
import { UploadManager } from "bunsane/upload";
import { PermissionRestService } from "./services/PermissionService";

export default class TasksAPI extends App {
  constructor() {
    super("Tasks Management API", "1.0.0");

    // Register plugins
    this.addPlugin(new AuthPlugin());
    this.enableStudio();

    // Set up auth context from OIDC token + auto-sync user
    this.setGraphQLContextFactory(async (context: { request: Request }) => {
      const user = await AuthPlugin.extractUser(context.request);
      if (user) {
        try {
          const userService = new UserService();
          await userService.syncFromOIDC({
            sub: user.sub,
            email: user.email,
            name: user.name,
            picture: user.picture,
            role: user.role,
          });
        } catch (err) {
          console.error("[AuthPlugin] Failed to sync user from OIDC:", err);
        }
      }
      return { user, request: context.request };
    });

    this.setCors({
      origin: (process.env.CORS_ORIGINS || "http://localhost:4000,http://localhost:3001").split(",").map(o => o.trim()),
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    });

    // Initialize S3 storage provider
    const s3Provider = new S3StorageProvider({
      endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
      accessKeyId: process.env.S3_ACCESS_KEY ?? "rustfsadmin",
      secretAccessKey: process.env.S3_SECRET_KEY ?? "rustfsadmin",
      bucket: process.env.S3_BUCKET ?? "tasks-media",
      publicUrl:
        process.env.S3_PUBLIC_URL ?? "http://localhost:9000/tasks-media",
    });
    const uploadManager = UploadManager.getInstance();
    uploadManager.registerStorageProvider("s3", s3Provider);
    uploadManager.setDefaultStorageProvider("s3");

    // Register services
    ServiceRegistry.registerService(new ActivityService());
    ServiceRegistry.registerService(new TaskService());
    ServiceRegistry.registerService(new ProjectService());
    ServiceRegistry.registerService(new ModuleService());
    ServiceRegistry.registerService(new LabelService());
    ServiceRegistry.registerService(new UserService());
    ServiceRegistry.registerService(new MediaService());
    ServiceRegistry.registerService(new CommentService());
    ServiceRegistry.registerService(new NotificationService());
    ServiceRegistry.registerService(new PageService());
    ServiceRegistry.registerService(new MembershipService());

    ServiceRegistry.registerService(new PermissionRestService());
  }
}
