import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Upload,
  RefreshCw,
  ArrowUpDown,
  Grid3X3,
  List,
  Layers,
  Search,
  ArrowUp,
} from "lucide-react";
import { useUIStore } from "@/stores/ui-store";
import type { MediaViewMode } from "@/types/media";
import type { FileManagerState, SortField } from "@/hooks/use-file-manager";
import styles from "./file-manager-toolbar.module.css";

interface FileManagerToolbarProps {
  fm: FileManagerState;
  onUploadClick: () => void;
  onRefresh: () => void;
  showUpButton?: boolean;
}

const sortLabels: Record<SortField, string> = {
  name: "Name",
  size: "Size",
  date: "Date",
  type: "Type",
};

export function FileManagerToolbar({
  fm,
  onUploadClick,
  onRefresh,
  showUpButton,
}: FileManagerToolbarProps) {
  const { mediaViewMode, setMediaViewMode } = useUIStore();

  return (
    <div className={styles.toolbar}>
      <div className={styles.left}>
        {showUpButton && (
          <Button
            size="sm"
            variant="ghost"
            onClick={fm.goUp}
            title="Go up"
          >
            <ArrowUp className={styles.icon} />
          </Button>
        )}

        <Button size="sm" variant="outline" onClick={onUploadClick}>
          <Upload className={styles.icon} />
          Upload
        </Button>

        <Button size="sm" variant="ghost" onClick={onRefresh} title="Refresh">
          <RefreshCw className={styles.icon} />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost">
              <ArrowUpDown className={styles.icon} />
              {sortLabels[fm.sortBy]}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuRadioGroup
              value={fm.sortBy}
              onValueChange={(v) => fm.setSortBy(v as SortField)}
            >
              <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="date">Date</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="size">Size</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="type">Type</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className={styles.right}>
        <div className={styles.searchWrapper}>
          <Search className={styles.searchIcon} />
          <Input
            placeholder="Search..."
            value={fm.searchQuery}
            onChange={(e) => fm.setSearchQuery(e.target.value)}
            className={styles.searchInput}
          />
        </div>

        <Button
          size="sm"
          variant={fm.flatten ? "secondary" : "ghost"}
          onClick={fm.toggleFlatten}
          title="Flatten — show all files"
        >
          <Layers className={styles.icon} />
        </Button>

        <Tabs
          value={mediaViewMode}
          onValueChange={(v) => setMediaViewMode(v as MediaViewMode)}
        >
          <TabsList className={styles.tabsList}>
            <TabsTrigger value="grid" className={styles.tabsTrigger}>
              <Grid3X3 className={styles.tabsIcon} />
            </TabsTrigger>
            <TabsTrigger value="table" className={styles.tabsTrigger}>
              <List className={styles.tabsIcon} />
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </div>
  );
}
