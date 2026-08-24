$fs = 0.4;

cover_width = 71.75;
cover_height = 116.25;
cover_depth = 19.25;

inset_width = 20.25;
inset_height = 71;
inset_depth = 12.5;

switch_width = 11;
switch_height = 25;

plate_width = 62;
plate_height = 108;
plate_depth = 5.25;

hole_diameter = 4.5;
hole_to_switch = 15.5;

brick_size = 16;
mortar_size = 1;
brick_x_offset = 9.6;
brick_z_offset = -3;

slot_length = 37;
slot_width = 5.5;
slot_depth = 1.5;
slot_source_diameter = 30;
slot_from_top = 3;
slot_from_bottom = 1;

// These messages are visible in Carve's Compilation log. Change a dimension
// to an invalid value to see the assertion and its source line.
echo("Plate dimensions", width = cover_width, height = cover_height, depth = cover_depth);
assert(cover_width > 0 && cover_height > 0 && cover_depth > 0,
       "Cover dimensions must all be greater than zero");
assert(inset_width < cover_width && inset_height < cover_height,
       "The inset must fit inside the cover");

module hole() {
    translate([
        cover_width / 2, 
        ((cover_height - switch_height) / 2) - hole_to_switch, 
        0
    ])
        cylinder(cover_depth, hole_diameter / 2, hole_diameter / 2);
}

module slot() {
    slot_radius = (slot_width + slot_source_diameter) / 2;
    slot_bounds_height = (inset_depth - slot_from_top - slot_from_bottom);

    translate([
        (cover_width - inset_width) / 2, 
        (cover_height - 2 * slot_radius) / 2, 
        -slot_radius + slot_bounds_height + cover_depth 
            - inset_depth + slot_from_bottom
    ]) {
        rotate([0, -90, 0]) {
            difference() {
                translate([0, slot_radius, 0]) {
                    difference() {
                        cylinder(
                            slot_depth, 
                            d = slot_radius * 2,
                            center = false
                        );
                        cylinder(slot_depth, d = slot_source_diameter);
                    }
                }
                
                translate([-slot_radius, 0, 0])
                    cube([
                            2 * slot_radius - slot_bounds_height, 
                            slot_radius * 2,
                            slot_radius * 2
                    ]);    
            }
        }
    }
}

module brick_lines() {
    translate([brick_x_offset, 0, 0]) {
        cols = floor(cover_width / (brick_size + mortar_size));
        
        for (i = [0 : 3]) {
            translate([i * (brick_size + mortar_size), 0, 0])
                cube([mortar_size, cover_height, mortar_size + .1]);
        }
    }
        
    rows = floor(cover_height / (brick_size + mortar_size));
    
    for (i = [1 : rows]) {
        translate([0, i * (brick_size + mortar_size), 0])
            cube([cover_width, mortar_size, mortar_size + .1]);
    }
}

color("grey") {
    difference() {
        cube([cover_width, cover_height, cover_depth]);
        
        translate([
            (cover_width - inset_width) / 2, 
            (cover_height - inset_height) / 2, 
            cover_depth - inset_depth
        ])
            cube([inset_width, inset_height, inset_depth]);
        
        translate([
            (cover_width - switch_width) / 2, 
            (cover_height - switch_height) / 2, 
            0
        ])
            cube([switch_width, switch_height, cover_depth]);
            
        translate([cover_width / 2, cover_height / 2])
            linear_extrude(
                height = plate_depth,
                scale = [
                    plate_width / cover_width,
                    plate_height / cover_height
                ]
            )
                square([cover_width, cover_height], center = true);

        hole();
            
        translate([0, 2 * hole_to_switch + switch_height, 0]) hole();

        slot();
        translate([inset_width + slot_depth, 0, 0]) slot();

        translate([0, 0, cover_depth - mortar_size]) brick_lines();


    // These seem more logical, but don't z-offset consistent with the original
    //    translate([0, mortar_size, (-brick_size / 2) - brick_z_offset]) 
    //        rotate([90, 0, 0]) brick_lines();   
    //
    //    translate([0, cover_height, (-brick_size / 2) - brick_z_offset]) 
    //        rotate([90, 0, 0]) brick_lines();
    // 

        translate([
            2 * mortar_size + cover_width + brick_x_offset / 2, 
            mortar_size, 
            (-mortar_size / 2) - brick_z_offset
        ]) 
            rotate([0, -90, 90]) brick_lines();   

        translate([
            2 * mortar_size + cover_width + brick_x_offset / 2, 
            cover_height, 
            (-mortar_size / 2) - brick_z_offset
        ]) 
            rotate([0, -90, 90]) brick_lines();   

        translate([mortar_size, 0, (-mortar_size / 2) - brick_z_offset]) 
            rotate([0, -90, 0]) brick_lines();   

        translate([cover_width, 0, (-mortar_size / 2) - brick_z_offset]) 
            rotate([0, -90, 0]) brick_lines();       
    }
}
