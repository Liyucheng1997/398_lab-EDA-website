`timescale 1ns / 1ps

// CLK_HZ = 100（1 秒 = 100 拍）、SCAN_HZ = 50（每位 2 拍）
module tb;
  localparam CLK_HZ = 100, SCAN_HZ = 50;

  logic        clk = 0;
  logic [15:0] sw = 0;
  logic [4:0]  btn = 0;
  logic [15:0] led;
  logic [7:0]  seg_n;
  logic [3:0]  an_n;
  integer      errors = 0;

  virtual_starter #(.CLK_HZ(CLK_HZ), .SCAN_HZ(SCAN_HZ)) dut (
    .clk(clk), .sw(sw), .btn(btn), .led(led), .seg_n(seg_n), .an_n(an_n)
  );

  always #5 clk = ~clk;

  // 数码管监视器：记录每一位的段码（高电平 = 点亮，去掉小数点）
  logic [6:0] digit_seg [0:3];
  always @(negedge clk) begin
    case (an_n)
      4'b1110: digit_seg[0] = ~seg_n[6:0];
      4'b1101: digit_seg[1] = ~seg_n[6:0];
      4'b1011: digit_seg[2] = ~seg_n[6:0];
      4'b0111: digit_seg[3] = ~seg_n[6:0];
      default: ;
    endcase
  end

  function automatic logic [3:0] seg_to_hex(input logic [6:0] s);
    case (s)
      7'h3F: seg_to_hex = 4'h0;  7'h06: seg_to_hex = 4'h1;  7'h5B: seg_to_hex = 4'h2;
      7'h4F: seg_to_hex = 4'h3;  7'h66: seg_to_hex = 4'h4;  7'h6D: seg_to_hex = 4'h5;
      7'h7D: seg_to_hex = 4'h6;  7'h07: seg_to_hex = 4'h7;  7'h7F: seg_to_hex = 4'h8;
      7'h6F: seg_to_hex = 4'h9;  7'h77: seg_to_hex = 4'hA;  7'h7C: seg_to_hex = 4'hB;
      7'h39: seg_to_hex = 4'hC;  7'h5E: seg_to_hex = 4'hD;  7'h79: seg_to_hex = 4'hE;
      default: seg_to_hex = 4'hF;
    endcase
  endfunction

  function automatic logic [15:0] shown();
    return {seg_to_hex(digit_seg[3]), seg_to_hex(digit_seg[2]), seg_to_hex(digit_seg[1]), seg_to_hex(digit_seg[0])};
  endfunction

  task automatic expect_shown(input logic [15:0] exp);
    repeat (10) @(negedge clk);   // 让扫描刷新完 4 位
    $display("数码管显示 %h（期望 %h），LED = %b", shown(), exp, led);
    if (shown() !== exp) errors = errors + 1;
  endtask

  initial begin
    $dumpfile("dump.vcd");
    $dumpvars(0, tb);

    // 开关 → LED 与数码管
    sw = 16'h1234;
    expect_shown(16'h1234);
    if (led !== 16'h1234) errors = errors + 1;
    sw = 16'hBEEF;
    expect_shown(16'hBEEF);

    // 中键：LED 取反
    btn[0] = 1;
    #1 if (led !== ~16'hBEEF) begin $display("错误：按住 BTNC 时 LED 应取反"); errors = errors + 1; end
    btn[0] = 0;

    // 运行约 3 秒后按住上键：显示秒数
    repeat (3 * CLK_HZ) @(negedge clk);
    btn[1] = 1;
    expect_shown(16'h0003);
    btn[1] = 0;

    // 下键：全部熄灭
    btn[4] = 1;
    repeat (4) @(negedge clk);
    if (an_n !== 4'b1111) begin $display("错误：按住 BTND 时数码管应熄灭"); errors = errors + 1; end
    btn[4] = 0;

    if (errors == 0) $display("PASS: 虚拟开发板入门设计行为正确");
    else             $display("FAIL: %0d 处错误", errors);
    $finish;
  end
endmodule
