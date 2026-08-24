text = "IVY";
height = 50;
thickness = 5;

belt_thickness = 4;

string_width = 88.5; // measured from string rendering
string_height = 54.9; // measured from string rendering

frame_width = 110;
frame_thickness = 5;
frame_height = string_height + 2 * frame_thickness; // measured from string rendering

loop_height = frame_height;
loop_width = frame_thickness;
loop_thickness = 3;

ivy_thickness = 2;

module belt_loop() {
    color("white") {
        cube([loop_width, loop_height, loop_thickness]);

        translate([0, 0, loop_thickness])
            cube([loop_width, loop_thickness, belt_thickness]);

        translate([0, loop_height - loop_thickness, loop_thickness])
            cube([loop_width, loop_thickness, belt_thickness]);
    }
}

module frame() {
    color("white") {
        difference() {
            cube([frame_width, frame_height, thickness]);
            translate([frame_thickness, frame_thickness, 0])
                cube([
                    frame_width - 2 * frame_thickness,
                    frame_height - 2 * frame_thickness,
                    thickness
                ]);
        }
    }
}

module ivy() {
    translate([0, 0, thickness - ivy_thickness]) {
        linear_extrude(height = ivy_thickness) {
            rotate([0, 0, 15])
                translate([40, 5, 0])
                    scale([.3, .3, 1])
                        import("ivy.svg", center=true);

            mirror([0, 1, 0])
                translate([50, 20, 0])
                    scale([.3, .3, 1])
                        import("ivy.svg", center=true);

            translate([105, 45, 0])
                scale([.3, .3, 1])
                    import("ivy.svg", center=true);
        }
    }
}

module loops() {
    translate([0, (frame_height - loop_height) / 2, 0]) {
        translate([0, 0, 0]) belt_loop();
        translate([(frame_width - loop_width) / 2, 0, 0]) belt_loop();
        translate([frame_width - loop_width, 0, 0]) belt_loop();
    }
}

module plate() {
    color("gold") frame();

    translate([
        ((frame_width - string_width - frame_thickness) / 2),
        frame_thickness,
        0
    ]) {
        color("red") {
            linear_extrude(height = thickness)
                text(
                    text = text,
                    size = height,
                    font = "Impact"
                );
        }
    }
}

loops();
translate([ 0, 0, belt_thickness + loop_thickness ]) {
    difference() {
        plate();
        ivy();
    }

    color("green")
        intersection() {
            ivy();
            plate();
        }
}
