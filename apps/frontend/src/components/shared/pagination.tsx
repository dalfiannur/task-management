import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import styles from "./pagination.module.css";

interface PaginationProps {
  currentPage: number;
  hasNextPage: boolean;
  onPageChange: (page: number) => void;
}

export function Pagination({ currentPage, hasNextPage, onPageChange }: PaginationProps) {
  return (
    <div className={styles.container}>
      <Button
        variant="outline"
        size="sm"
        disabled={currentPage <= 1}
        onClick={() => onPageChange(currentPage - 1)}
      >
        <ChevronLeft className={styles.icon} />
        Previous
      </Button>
      <span className={styles.pageIndicator}>Page {currentPage}</span>
      <Button
        variant="outline"
        size="sm"
        disabled={!hasNextPage}
        onClick={() => onPageChange(currentPage + 1)}
      >
        Next
        <ChevronRight className={styles.icon} />
      </Button>
    </div>
  );
}
