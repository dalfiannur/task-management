import TasksAPI from "./App";

const app = new TasksAPI();

try {
  app.init();
} catch (error) {
  console.error(error);
  process.exit(1);
}
