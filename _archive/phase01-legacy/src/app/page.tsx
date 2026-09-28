import { AppShell } from "@/components/layout/app-shell"
import { StatCard } from "@/components/common/stat-card"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Users, CheckSquare, FileText, Calendar, AlertCircle } from "lucide-react"

export default function Home() {
  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-h2">Good morning 👋</h1>
          <p className="text-muted-foreground">Here's what's happening today.</p>
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Active Interns"
            value={42}
            change={12}
            changeType="increase"
            icon={Users}
          />
          <StatCard
            title="Open Tasks"
            value={18}
            change={5}
            changeType="decrease"
            icon={CheckSquare}
          />
          <StatCard
            title="Pending Reviews"
            value={7}
            icon={FileText}
          />
          <StatCard
            title="Upcoming Deadlines"
            value={5}
            icon={Calendar}
          />
        </div>

        {/* Content Grid */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Recent Activity */}
          <Card className="col-span-2">
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <div className="rounded-full bg-primary/10 p-2">
                    <CheckSquare className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">Task completed: "Design homepage mockup"</p>
                    <p className="text-xs text-muted-foreground">2 hours ago by Sarah Chen</p>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="rounded-full bg-success/10 p-2">
                    <Users className="h-4 w-4 text-success" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">New intern onboarded: Michael Brown</p>
                    <p className="text-xs text-muted-foreground">4 hours ago by HR Team</p>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="rounded-full bg-warning/10 p-2">
                    <AlertCircle className="h-4 w-4 text-warning" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">Leave request pending: Alex Johnson</p>
                    <p className="text-xs text-muted-foreground">6 hours ago</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="outline" className="w-full justify-start">
                <CheckSquare className="mr-2 h-4 w-4" />
                Create Task
              </Button>
              <Button variant="outline" className="w-full justify-start">
                <Users className="mr-2 h-4 w-4" />
                Add Intern
              </Button>
              <Button variant="outline" className="w-full justify-start">
                <FileText className="mr-2 h-4 w-4" />
                View Reports
              </Button>
              <Button variant="outline" className="w-full justify-start">
                <Calendar className="mr-2 h-4 w-4" />
                Schedule Meeting
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Upcoming Deadlines */}
        <Card>
          <CardHeader>
            <CardTitle>Upcoming Deadlines</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Badge variant="warning">High Priority</Badge>
                  <span className="text-sm">Q3 Performance Reviews</span>
                </div>
                <span className="text-sm text-muted-foreground">Due in 2 days</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Badge variant="info">Medium Priority</Badge>
                  <span className="text-sm">Website Redesign Launch</span>
                </div>
                <span className="text-sm text-muted-foreground">Due in 5 days</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Badge variant="secondary">Low Priority</Badge>
                  <span className="text-sm">Intern Orientation Materials</span>
                </div>
                <span className="text-sm text-muted-foreground">Due in 1 week</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
