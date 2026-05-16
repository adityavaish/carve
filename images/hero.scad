// Carve marketplace hero scene — a stylized "C" carved from a cube.
$fn = 80;

difference() {
  // Base rounded cube
  hull() {
    for (x = [-25, 25], y = [-25, 25], z = [-25, 25])
      translate([x, y, z]) sphere(6);
  }

  // Inner cylindrical bore (forms the bowl of the C)
  rotate([90, 0, 0]) cylinder(h = 80, r = 18, center = true);

  // Opening on the right side that turns the bore into a C
  translate([20, 0, 0]) cube([30, 30, 30], center = true);

  // Top accent groove
  translate([0, 0, 22]) rotate([0, 90, 0]) cylinder(h = 80, r = 3, center = true);
}

// Subtle base plate
color("white") translate([0, 0, -34]) cube([72, 72, 4], center = true);
