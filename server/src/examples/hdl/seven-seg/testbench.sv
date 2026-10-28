`timescale 1ns / 1ps

// 穷举 16 个输入，并把每个数字用字符画「点亮」出来
module tb;
  logic [3:0] hex;
  logic [6:0] seg;
  integer     errors = 0;

  // 期望值表：每个十六进制数字点亮的段（gfedcba）
  logic [6:0] golden [0:15];

  hex_to_7seg dut (.hex(hex), .seg(seg));

  // 把七段码画成 3 行字符画
  task automatic draw(input logic [6:0] s);
    $display("   %s ", s[0] ? "_" : " ");
    $display("  %s%s%s", s[5] ? "|" : " ", s[6] ? "_" : " ", s[1] ? "|" : " ");
    $display("  %s%s%s", s[4] ? "|" : " ", s[3] ? "_" : " ", s[2] ? "|" : " ");
  endtask

  initial begin
    $dumpfile("dump.vcd");
    $dumpvars(0, tb);

    golden[0]  = 7'h3F; golden[1]  = 7'h06; golden[2]  = 7'h5B; golden[3]  = 7'h4F;
    golden[4]  = 7'h66; golden[5]  = 7'h6D; golden[6]  = 7'h7D; golden[7]  = 7'h07;
    golden[8]  = 7'h7F; golden[9]  = 7'h6F; golden[10] = 7'h77; golden[11] = 7'h7C;
    golden[12] = 7'h39; golden[13] = 7'h5E; golden[14] = 7'h79; golden[15] = 7'h71;

    for (integer i = 0; i < 16; i = i + 1) begin
      hex = i[3:0];
      #10;
      $display("hex = %h, seg = %b", hex, seg);
      draw(seg);
      if (seg !== golden[i]) begin
        $display("  错误：期望 %b", golden[i]);
        errors = errors + 1;
      end
    end

    if (errors == 0) $display("PASS: 16 个字形全部正确");
    else             $display("FAIL: %0d 个字形错误", errors);
    $finish;
  end
endmodule
