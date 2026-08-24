$fs = 0.4;

grip_size = 16;
grip_length = 18;

lever_length = 81;
tip_height = 8;
cut_from_end = 17;
tip_right_edge = (grip_size + tip_height) / 2;

pin_height = 3.6;
pin_width = 5;
pin_setback = 1;

switch_height = 6;
switch_width = 7;
switch_depth = 15;

epsilon = 0.00;

module end_cutter() {
  translate([0, grip_size + epsilon, 0])
      rotate([90, 0, 0])
          linear_extrude(height = grip_size + 2 * epsilon)
              polygon([
                  [grip_size, lever_length - cut_from_end],
                  [grip_size, lever_length],
                  [tip_right_edge, lever_length]
              ]);
}

module pin() {
    translate([
        grip_size / 2, 
        0, 
        lever_length + grip_length - pin_setback - pin_width / 2
    ])
        rotate([90, 90, 0])
            cylinder(pin_height, pin_width / 2, pin_width / 2);
}

// grip
color("grey") cube([grip_size, grip_size, grip_length]);

color("saddlebrown") {
    difference() {
        // lever    
        translate([0, 0, grip_length])
            difference() {
              cube([grip_size, grip_size, lever_length]);

              // First side
              end_cutter();

              // Mirrored opposite side
              translate([grip_size, 0, 0])
                  mirror([1, 0, 0])
                      end_cutter();
            }
        
        // switch hole
        translate([
            (grip_size - switch_height) / 2, 
            (grip_size - switch_width) / 2, 
            grip_length + lever_length - switch_depth
        ]) cube([switch_height, switch_width, switch_depth]);
    }
        
    // pins
    pin();
    
    translate([0, grip_size, 0]) mirror([0, 1, 0]) pin();
}
    
