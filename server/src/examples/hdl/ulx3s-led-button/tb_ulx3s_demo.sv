`timescale 1ns / 1ps

// CLK_HZ = 200、DEBOUNCE_MS = 10：消抖 2 拍；速度 1 档时每 50 拍一步
module tb;
  localparam CLK_HZ = 200, DEBOUNCE_MS = 10;
  localparam B_F1 = 0, B_F2 = 1, B_UP = 2, B_DOWN = 3, B_LEFT = 4, B_RIGHT = 5;

  logic       clk = 0, rst_n = 0;
  logic [5:0] btn = 0;
  logic [3:0] sw = 0;
  logic [7:0] led;
  integer     errors = 0;

  ulx3s_demo #(.CLK_HZ(CLK_HZ), .DEBOUNCE_MS(DEBOUNCE_MS)) dut (
    .clk(clk), .rst_n(rst_n), .btn(btn), .sw(sw), .led(led)
  );

  always #5 clk = ~clk;

  task automatic press(input integer b);
    btn[b] = 1;
    repeat (8) @(negedge clk);
    btn[b] = 0;
    repeat (8) @(negedge clk);
  endtask

  // 等待 LED 变化，返回经过的拍数
  task automatic wait_change(output integer cycles);
    logic [7:0] start_led;
    start_led = led;
    cycles = 0;
    while (led === start_led && cycles < 1000) begin
      @(negedge clk);
      cycles = cycles + 1;
    end
  endtask

  task automatic check(input logic cond, input integer id);
    if (!cond) begin
      $display("[%0t] 错误：检查点 %0d 失败，led = %b", $time, id, led);
      errors = errors + 1;
    end
  endtask

  initial begin
    integer     n, n_slow;
    logic [7:0] snap;
    $dumpfile("dump.vcd");
    $dumpvars(0, tb);

    repeat (3) @(negedge clk);
    rst_n = 1;
    repeat (3) @(negedge clk);

    // 1) 流水灯：独热码向高位移动
    check(led == 8'b0000_0001, 1);
    wait_change(n);
    check(led == 8'b0000_0010, 2);
    wait_change(n);
    $display("流水灯：每 %0d 拍移动一格，led = %b", n, led);
    check(led == 8'b0000_0100, 3);
    n_slow = n;

    // 2) 加速：步进间隔减半
    press(B_UP);
    wait_change(n);
    wait_change(n);
    $display("按 UP 加速后：每 %0d 拍移动一格", n);
    check(n * 2 == n_slow, 4);

    // 3) RIGHT：反向运动
    press(B_RIGHT);
    snap = led;
    wait_change(n);
    check(led == (snap >> 1), 5);

    // 4) F1 暂停
    press(B_F1);
    snap = led;
    repeat (200) @(negedge clk);
    check(led === snap, 6);
    $display("F1 暂停：LED 保持 %b", led);
    press(B_F1);

    // 5) F2 切换两次到计数模式，LEFT 改为递增
    press(B_F2);
    press(B_F2);
    press(B_LEFT);
    wait_change(n);
    snap = led;
    wait_change(n);
    $display("计数模式：%0d -> %0d", snap, led);
    check(led == snap + 8'd1, 7);

    // 6) 拨码开关：取反
    sw[0] = 1;
    #1 check(led == ~(snap + 8'd1) || led == ~(snap + 8'd2), 8);
    sw[0] = 0;

    // 7) SW4：直接显示按键
    sw[3] = 1;
    btn[B_DOWN] = 1;
    repeat (6) @(negedge clk);
    check(led == 8'b0000_1000, 9);
    btn[B_DOWN] = 0;
    sw[3] = 0;
    repeat (6) @(negedge clk);

    // 8) 复位：回到流水灯初始状态
    rst_n = 0;
    @(negedge clk);
    rst_n = 1;
    repeat (3) @(negedge clk);
    check(led == 8'b0000_0001, 10);

    if (errors == 0) $display("PASS: ULX3S 演示的按键与开关功能全部正确");
    else             $display("FAIL: %0d 处错误", errors);
    $finish;
  end
endmodule
