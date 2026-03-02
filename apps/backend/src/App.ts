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
import "./components/TaskMediaLink";
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
      if (!user) {
        throw new Error("Authentication required");
      }

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

      return { user, request: context.request };
    });

    this.setCors({
      origin: (process.env.CORS_ORIGINS || "http://localhost:4000,http://localhost:3001").split(",").map(o => o.trim()),
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    });

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
