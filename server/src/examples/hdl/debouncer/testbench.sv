`timescale 1ns / 1ps

// 模拟机械按键的抖动：按下和松开时各有一串随机长度的毛刺。
// 期望：每次按下只产生 1 个 pressed 脉冲，每次松开只产生 1 个 released 脉冲。
module tb;
  localparam STABLE = 16;

  logic   clk = 0, rst = 1, btn_in = 0;
  logic   btn_out, pressed, released;
  integer n_pressed = 0, n_released = 0, errors = 0;

  debouncer #(.STABLE_CYCLES(STABLE)) dut (
    .clk(clk), .rst(rst), .btn_in(btn_in),
    .btn_out(btn_out), .pressed(pressed), .released(released)
  );

  always #5 clk = ~clk;

  always @(posedge clk) begin
    if (pressed)  n_pressed  = n_pressed + 1;
    if (released) n_released = n_released + 1;
  end

  // 产生一段抖动后稳定到 level
  task automatic bounce_to(input logic level);
    integer glitches;
    glitches = 3 + ($random & 7);
    repeat (glitches) begin
      btn_in = ~btn_in;
      #(1 + ($random & 63));  // 1~64 ns 的随机毛刺（远小于 16 个时钟 = 160 ns）
    end
    btn_in = level;
  endtask

  // $random 的序列在每次仿真中都相同，因此结果可复现
  initial begin
    $dumpfile("dump.vcd");
    $dumpvars(0, tb);
    repeat (3) @(negedge clk);
    rst = 0;

    for (integer i = 0; i < 4; i = i + 1) begin
      bounce_to(1'b1);
      #(STABLE * 10 * 3);  // 稳定按住
      if (btn_out !== 1'b1) begin
        $display("错误：第 %0d 次按下后 btn_out 未变为 1", i + 1);
        errors = errors + 1;
      end
      bounce_to(1'b0);
      #(STABLE * 10 * 3);
      if (btn_out !== 1'b0) begin
        $display("错误：第 %0d 次松开后 btn_out 未变为 0", i + 1);
        errors = errors + 1;
      end
    end

    // 一个短于消抖时间的尖峰应被完全滤除
    btn_in = 1; #50; btn_in = 0;
    #(STABLE * 10 * 3);

    $display("按下脉冲 %0d 次，松开脉冲 %0d 次（期望各 4 次）", n_pressed, n_released);
    if (n_pressed != 4 || n_released != 4) errors = errors + 1;

    if (errors == 0) $display("PASS: 抖动被正确滤除");
    else             $display("FAIL: %0d 处错误", errors);
    $finish;
  end
endmodule
