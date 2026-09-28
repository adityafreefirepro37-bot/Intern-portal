import * as React from "react"
import { cn } from "@/lib/utils"

interface LoadingStateProps {
  className?: string
}

export function LoadingState({ className }: LoadingStateProps) {
  return (
    <div className={cn("flex items-center justify-center py-12", className)}>
      <div className="flex space-x-2">
        <div className="h-3 w-3 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
        <div className="h-3 w-3 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
        <div className="h-3 w-3 animate-bounce rounded-full bg-primary" />
      </div>
    </div>
  )
}
