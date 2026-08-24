$fn = 128;

// Core dimensions
inner_diameter = 22;
thickness = 5;
outer_diameter = inner_diameter + 2 * thickness;
length = 25;
open_angle = 25;
show_preview = true;

// Split and print clearances
seam_gap = 0.7;
hinge_pin_clearance = 0.35;
knuckle_axial_gap = 0.5;

// Hinge geometry
hinge_knuckle_od = 4.6;
hinge_pin_d = 2.0;
hinge_pin_head_d = 3.2;
hinge_pin_head_h = 0.8;

// Latch geometry
latch_nub_d = 2.0;
latch_nub_len = 2.0;
latch_socket_clearance = 0.35;
latch_y_offset = 0.0;

outer_r = outer_diameter / 2;
inner_r = inner_diameter / 2;

// Hinge axis is parallel to Z and centered in the wall on +Y side.
hinge_axis_x = 0;
hinge_axis_y = (outer_r + inner_r) / 2;

// Latch sits opposite the hinge on -Y side.
latch_y = -((outer_r + inner_r) / 2) + latch_y_offset;

// Three-knuckle layout: 2 outer on one half, 1 center on the other.
end_margin = 1.6;
usable_z = length - 2 * end_margin;
knuckle_len = (usable_z - 2 * knuckle_axial_gap) / 3;
z0 = end_margin;
z1 = z0 + knuckle_len + knuckle_axial_gap;
z2 = z1 + knuckle_len + knuckle_axial_gap;

module tube_shell() {
    difference() {
        cylinder(d = outer_diameter, h = length);
        cylinder(d = inner_diameter, h = length);
    }
}

module half_shell(right_half = true) {
    big = outer_diameter * 4;
    intersection() {
        tube_shell();
        if (right_half)
            translate([seam_gap / 2, -big / 2, -1])
                cube([big, big, length + 2]);
        else
            translate([-big, -big / 2, -1])
                cube([big - seam_gap / 2, big, length + 2]);
    }
}

module hinge_relief() {
    translate([hinge_axis_x, hinge_axis_y, -0.2])
        cylinder(d = hinge_knuckle_od + 1.0, h = length + 0.4);
}

module right_outer_knuckles() {
    translate([hinge_axis_x, hinge_axis_y, z0])
        cylinder(d = hinge_knuckle_od, h = knuckle_len);
    translate([hinge_axis_x, hinge_axis_y, z2])
        cylinder(d = hinge_knuckle_od, h = knuckle_len);
}

module left_center_knuckle() {
    translate([hinge_axis_x, hinge_axis_y, z1])
        cylinder(d = hinge_knuckle_od, h = knuckle_len);
}

module right_outer_bores() {
    d = hinge_pin_d + hinge_pin_clearance;
    translate([hinge_axis_x, hinge_axis_y, z0 - 0.1])
        cylinder(d = d, h = knuckle_len + 0.2);
    translate([hinge_axis_x, hinge_axis_y, z2 - 0.1])
        cylinder(d = d, h = knuckle_len + 0.2);
}

module left_center_bore() {
    d = hinge_pin_d + hinge_pin_clearance;
    translate([hinge_axis_x, hinge_axis_y, z1 - 0.1])
        cylinder(d = d, h = knuckle_len + 0.2);
}

module hinge_pin() {
    color("dodgerblue")
        union() {
            translate([hinge_axis_x, hinge_axis_y, 0])
                cylinder(d = hinge_pin_d, h = length);
            translate([hinge_axis_x, hinge_axis_y, 0])
                cylinder(d = hinge_pin_head_d, h = hinge_pin_head_h);
            translate([hinge_axis_x, hinge_axis_y, length - hinge_pin_head_h])
                cylinder(d = hinge_pin_head_d, h = hinge_pin_head_h);
        }
}

module latch_nub_on_right() {
    color("limegreen")
        translate([latch_nub_len / 2 + seam_gap / 2, latch_y, length / 2])
            rotate([0, 90, 0])
                cylinder(d = latch_nub_d, h = latch_nub_len, center = true);
}

module latch_socket_in_left(show_preview = false) {
    d = latch_nub_d + latch_socket_clearance;
    if (show_preview)
        color("seagreen", 0.35)
            translate([-latch_nub_len / 2 - seam_gap / 2, latch_y, length / 2])
                rotate([0, 90, 0])
                    cylinder(d = d, h = latch_nub_len + 0.8, center = true);
    else
        translate([-latch_nub_len / 2 - seam_gap / 2, latch_y, length / 2])
            rotate([0, 90, 0])
                cylinder(d = d, h = latch_nub_len + 0.8, center = true);
}

module right_half() {
    union() {
        color("lightsteelblue")
            difference() {
                half_shell(true);
                hinge_relief();
            }

        color("gold")
            difference() {
                right_outer_knuckles();
                right_outer_bores();
            }

        latch_nub_on_right();
    }
}

module left_half() {
    union() {
        color("salmon")
            difference() {
                half_shell(false);
                hinge_relief();
                latch_socket_in_left();
            }

        color("gold")
            difference() {
                left_center_knuckle();
                left_center_bore();
            }

        latch_socket_in_left(show_preview = true);
    }
}

union() {
    left_half();

    translate([hinge_axis_x, hinge_axis_y, 0])
        rotate([0, 0, open_angle])
            translate([-hinge_axis_x, -hinge_axis_y, 0])
                right_half();

    hinge_pin();
}
