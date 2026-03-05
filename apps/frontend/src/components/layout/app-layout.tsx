import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { Header } from "./header";
import { CompanyInitializer } from "./company-initializer";
import styles from "./app-layout.module.css";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <CompanyInitializer />
      <AppSidebar />
      <SidebarInset>
        <Header />
        <main className={styles.main}>{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
