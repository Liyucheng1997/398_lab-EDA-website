`timescale 1ns / 1ps

// 仿真参数：CLK_HZ = 1000（0.01 s = 10 拍），SCAN_HZ = 250（每位 4 拍），消抖 10 拍。
// 测试平台像人眼一样「看」数码管：跟踪位选扫描，把每一位的段码解码回字符。
module tb;
  localparam CLK_HZ = 1000, SCAN_HZ = 250, DEBOUNCE_MS = 10;
  localparam B_C = 0, B_U = 1, B_L = 2, B_R = 3, B_D = 4;

  logic        clk = 0;
  logic [15:0] sw = 16'h0000;
  logic [4:0]  btn = 5'b00000;
  logic [15:0] led;
  logic [7:0]  seg_n;
  logic [3:0]  an_n;
  integer      errors = 0;

  basys3_stopwatch #(.CLK_HZ(CLK_HZ), .SCAN_HZ(SCAN_HZ), .DEBOUNCE_MS(DEBOUNCE_MS)) dut (
    .clk(clk), .sw(sw), .btn(btn), .led(led), .seg_n(seg_n), .an_n(an_n)
  );

  always #5 clk = ~clk;

  // ───────── 数码管监视器 ─────────
  logic [7:0] digit_seg [0:3];   // 每一位最近一次的段码（高电平 = 点亮）

  always @(negedge clk) begin
    case (an_n)
      4'b1110: digit_seg[0] = ~seg_n;
      4'b1101: digit_seg[1] = ~seg_n;
      4'b1011: digit_seg[2] = ~seg_n;
      4'b0111: digit_seg[3] = ~seg_n;
      default: ;
    endcase
  end

  function automatic logic [7:0] seg_to_char(input logic [6:0] s);
    case (s)
      7'h3F: seg_to_char = "0";  7'h06: seg_to_char = "1";  7'h5B: seg_to_char = "2";
      7'h4F: seg_to_char = "3";  7'h66: seg_to_char = "4";  7'h6D: seg_to_char = "5";
      7'h7D: seg_to_char = "6";  7'h07: seg_to_char = "7";  7'h7F: seg_to_char = "8";
      7'h6F: seg_to_char = "9";  7'h77: seg_to_char = "A";  7'h7C: seg_to_char = "b";
      7'h39: seg_to_char = "C";  7'h5E: seg_to_char = "d";  7'h79: seg_to_char = "E";
      7'h71: seg_to_char = "F";  7'h00: seg_to_char = " ";
      default: seg_to_char = "?";
    endcase
  endfunction

  // 读出当前显示内容，例如 "12.34"（最多 8 个字符）
  function automatic logic [8*8-1:0] display_text();
    logic [8*8-1:0] t;
    t = 0;
    for (integer i = 3; i >= 0; i = i - 1) begin
      t = {t[8*7-1:0], seg_to_char(digit_seg[i][6:0])};
      if (digit_seg[i][7]) t = {t[8*7-1:0], "."};
    end
    return t;
  endfunction

  task automatic press(input integer b);
    btn[b] = 1;
    repeat (DEBOUNCE_MS + 6) @(negedge clk);
    btn[b] = 0;
    repeat (DEBOUNCE_MS + 6) @(negedge clk);
  endtask

  task automatic expect_display(input logic [8*8-1:0] exp);
    repeat (40) @(negedge clk);   // 等扫描刷新完所有位
    $display("[%0t] 数码管显示：\"%0s\"", $time, display_text());
    if (display_text() !== exp) begin
      $display("  错误：期望 \"%0s\"", exp);
      errors = errors + 1;
    end
  endtask

  initial begin
    $dumpfile("dump.vcd");
    $dumpvars(0, tb);
    for (integer i = 0; i < 4; i = i + 1) digit_seg[i] = 0;

    // 1) 上电：00.00，LED 跟随开关
    expect_display("00.00");
    sw = 16'hA5C3;
    #1;
    if (led !== 16'hA5C3) begin $display("错误：LED 未跟随开关"); errors = errors + 1; end

    // 2) BTNC 开始计时，运行约 1.5 s 后暂停
    press(B_C);
    repeat (1500) @(negedge clk);
    press(B_C);
    $display("暂停时内部计数 %h%h.%h%h", dut.d3, dut.d2, dut.d1, dut.d0);
    if ({dut.d3, dut.d2} != 8'h01 || dut.d1 > 4'd9) begin
      $display("  错误：计时值应约为 01.5x");
      errors = errors + 1;
    end
    // 显示应与内部 BCD 计数一致（"0" 的 ASCII 码为 48）
    expect_display({8'd48 + 8'(dut.d3), 8'd48 + 8'(dut.d2), ".", 8'd48 + 8'(dut.d1), 8'd48 + 8'(dut.d0)});

    // 3) BTNR：显示开关值（十六进制）
    press(B_R);
    expect_display("A5C3");

    // 4) BTNL 回到秒表，BTNU 清零
    press(B_L);
    press(B_U);
    expect_display("00.00");

    // 5) 计次：运行中按 BTND 冻结显示
    press(B_C);
    repeat (300) @(negedge clk);
    press(B_D);
    begin : lap_check
      logic [8*8-1:0] frozen;
      repeat (40) @(negedge clk);
      frozen = display_text();
      repeat (500) @(negedge clk);
      $display("计次冻结显示 \"%0s\"，后台计数已到 %h%h.%h%h", frozen, dut.d3, dut.d2, dut.d1, dut.d0);
      if (display_text() !== frozen || {dut.d3, dut.d2, dut.d1, dut.d0} == 16'h0000) errors = errors + 1;
    end

    if (errors == 0) $display("PASS: Basys 3 秒表与开关功能全部正确");
    else             $display("FAIL: %0d 处错误", errors);
    $finish;
  end
endmodule
