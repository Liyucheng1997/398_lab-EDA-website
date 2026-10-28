`timescale 1ns / 1ps

// 十六进制 → 七段数码管译码器
//
//      --a--
//     |     |
//     f     b
//     |--g--|
//     e     c
//     |     |
//      --d--
//
// seg[6:0] = {g, f, e, d, c, b, a}，高电平点亮（共阴极）。
// 共阳极数码管（如 Basys 3）取反即可：seg_n = ~seg。
module hex_to_7seg (
  input  logic [3:0] hex,
  output logic [6:0] seg
);
  always_comb begin
    case (hex)          //  gfedcba
      4'h0:    seg = 7'b0111111;
      4'h1:    seg = 7'b0000110;
      4'h2:    seg = 7'b1011011;
      4'h3:    seg = 7'b1001111;
      4'h4:    seg = 7'b1100110;
      4'h5:    seg = 7'b1101101;
      4'h6:    seg = 7'b1111101;
      4'h7:    seg = 7'b0000111;
      4'h8:    seg = 7'b1111111;
      4'h9:    seg = 7'b1101111;
      4'hA:    seg = 7'b1110111;
      4'hB:    seg = 7'b1111100;
      4'hC:    seg = 7'b0111001;
      4'hD:    seg = 7'b1011110;
      4'hE:    seg = 7'b1111001;
      default: seg = 7'b1110001;  // F
    endcase
  end
endmodule
