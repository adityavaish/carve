$fn = 64;

flange_outer_diameter = 70;
flange_outer_radius = flange_outer_diameter / 2;
flange_thickness = 5;

curtain_rod_diameter = 36;
curtain_rod_radius = curtain_rod_diameter / 2;

cup_diameter = 40;
cup_radius = cup_diameter / 2;
cup_height = 50;
cup_lip = 10;

screw_hole_diameter = 4;
screw_hole_radius = screw_hole_diameter / 2;
counter_sink_diameter = 8.25;
counter_sink_radius = counter_sink_diameter / 2;

module flange() {
    difference() {
        cylinder(h = flange_thickness, r = flange_outer_radius);
        cylinder(h = flange_thickness, r = curtain_rod_radius);

        for (i=[0:3]) {
            rotate([0, 0, i * 90])
                translate([
                    (flange_outer_radius + cup_radius) / 2, 
                    0, 
                    0
                ]) {
                    cylinder(h = flange_thickness, r = screw_hole_radius);

                translate([0, 0, flange_thickness]) {
                    rotate([180, 0, 0])    
                        cylinder(h = flange_thickness, r1 = counter_sink_radius, r2 = 0);
                }
            }
        }
    }
}

flange();

translate([0, 0, cup_height / 2 + flange_thickness]) {
    difference() {
        cylinder(h = cup_height, r = cup_radius, center = true);
        cylinder(h = cup_height, r = curtain_rod_radius, center = true);
        translate([cup_radius, 0, cup_lip])
            cube([cup_diameter, cup_diameter, cup_height], center = true);
    }
}


