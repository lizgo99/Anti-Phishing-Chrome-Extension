import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & { indicatorClassName?: string }
>(({ className, value, indicatorClassName, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={`relative h-4 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800 ${className}`}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className={`h-full w-full flex-1 bg-primary transition-all dark:bg-primary ${indicatorClassName || ''}`}
      style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
    />
  </ProgressPrimitive.Root>
))
Progress.displayName = ProgressPrimitive.Root.displayName

export { Progress }
