"""Simulation by default; explicit opt-in for bounded ROS2 cmd_vel pulses."""
import math
import threading
import time

from robot_voice_sdk.types import Decision


class SimulationBridge:
    def __init__(self):
        self.x, self.y, self.yaw = 0.0, 0.0, 0.0
        self.stopped = True
        self.history = []

    def execute(self, decision: Decision) -> str:
        if not decision.approved or decision.action_id is None:
            self.history.append("NO_OP")
            return "NO_OP"
        action = decision.action_id
        if action == 0:
            self.stopped = True
        elif action == 1:
            self.x += 0.15 * math.cos(self.yaw)
            self.y += 0.15 * math.sin(self.yaw)
        elif action == 2:
            self.x -= 0.15 * math.cos(self.yaw)
            self.y -= 0.15 * math.sin(self.yaw)
        elif action == 3:
            self.yaw += math.pi / 12
        elif action == 4:
            self.yaw -= math.pi / 12
        elif action == 5:
            return "SIMULATED_GRASP_ONLY"
        self.history.append(decision.action_name)
        return "SIMULATED_" + decision.action_name


class Ros2Bridge:
    """Minimal ROS2 adapter, not a safety-certified controller.

    Requires Linux ROS2 environment with rclpy + geometry_msgs. Stop must also
    be enforced by an independent physical E-stop and controller watchdog.
    """

    def __init__(self, *, enable_live: bool = False):
        if not enable_live:
            raise RuntimeError("Live ROS2 is disabled by default; opt in explicitly")
        try:
            import rclpy
            from geometry_msgs.msg import Twist
        except ImportError as exc:
            raise RuntimeError("Source /opt/ros/<distro>/setup.bash; ROS2 packages missing") from exc
        self.rclpy, self.Twist = rclpy, Twist
        if not rclpy.ok():
            rclpy.init()
        self.node = rclpy.create_node("speech2action_safety_bridge")
        self.pub = self.node.create_publisher(Twist, "/cmd_vel", 10)
        self._lock = threading.Lock()

    def _zero(self):
        self.pub.publish(self.Twist())

    def execute(self, decision: Decision) -> str:
        if not decision.approved:
            return "NO_OP"
        if decision.action_id not in {0, 1, 2, 3, 4}:
            return "NO_OP_UNSUPPORTED"
        with self._lock:
            if decision.action_id == 0:
                self._zero()
                return "ROS2_STOP_PUBLISHED"
            twist = self.Twist()
            # Bounded velocity, short pulse; no arbitrary pose/LLM parameters.
            if decision.action_id == 1:
                twist.linear.x = 0.10
            elif decision.action_id == 2:
                twist.linear.x = -0.10
            elif decision.action_id == 3:
                twist.angular.z = 0.25
            elif decision.action_id == 4:
                twist.angular.z = -0.25
            try:
                end = time.monotonic() + 0.20
                while time.monotonic() < end:
                    self.pub.publish(twist)
                    time.sleep(0.025)
            finally:
                for _ in range(3):
                    self._zero()
                    time.sleep(0.025)
        return "ROS2_CMD_VEL_PULSE"

    def close(self):
        with self._lock:
            self._zero()
            self.node.destroy_node()
