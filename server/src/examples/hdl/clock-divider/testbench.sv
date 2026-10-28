`timescale 1ns / 1ps

// 同时例化 2、4、5、7 分频，测量输出周期与占空比
module tb;
  logic clk = 0, rst = 1;
  logic [3:0] clk_out, tick;
  integer errors = 0;

  clock_divider #(.DIV(2)) d2 (.clk(clk), .rst(rst), .clk_out(clk_out[0]), .tick(tick[0]));
  clock_divider #(.DIV(4)) d4 (.clk(clk), .rst(rst), .clk_out(clk_out[1]), .tick(tick[1]));
  clock_divider #(.DIV(5)) d5 (.clk(clk), .rst(rst), .clk_out(clk_out[2]), .tick(tick[2]));
  clock_divider #(.DIV(7)) d7 (.clk(clk), .rst(rst), .clk_out(clk_out[3]), .tick(tick[3]));

  always #5 clk = ~clk;  // 输入周期 10 ns

  // 测量某一路输出的高电平时间与周期
  task automatic measure(input integer ch, input integer div);
    realtime t_rise, t_fall, t_next;
    real     duty;
    // 用 wait 等待电平变化，依次捕获：上升沿 → 下降沿 → 下一个上升沿
    wait (clk_out[ch] == 1'b0);
    wait (clk_out[ch] == 1'b1); t_rise = $realtime;
    wait (clk_out[ch] == 1'b0); t_fall = $realtime;
    wait (clk_out[ch] == 1'b1); t_next = $realtime;
    duty = 100.0 * (t_fall - t_rise) / (t_next - t_rise);
    $display("DIV = %0d：周期 %0.1f ns（期望 %0d ns），占空比 %0.1f%%", div, t_next - t_rise, div * 10, duty);
    if (t_next - t_rise != div * 10.0 || duty != 50.0) errors = errors + 1;
  endtask

  // tick 计数：在 140 个输入周期内应出现 140/DIV 个脉冲
  integer ticks [0:3];
  always @(posedge clk)
    if (!rst)
      for (integer i = 0; i < 4; i = i + 1)
        if (tick[i]) ticks[i] = ticks[i] + 1;

  initial begin
    $dumpfile("dump.vcd");
    $dumpvars(0, tb);
    for (integer i = 0; i < 4; i = i + 1) ticks[i] = 0;

    repeat (3) @(negedge clk);
    rst = 0;

    fork
      measure(0, 2);
      measure(1, 4);
      measure(2, 5);
      measure(3, 7);
    join

    // 再统计一段时间内的 tick 数
    for (integer i = 0; i < 4; i = i + 1) ticks[i] = 0;
    repeat (140) @(posedge clk);
    #1;
    $display("140 个周期内 tick 次数：%0d %0d %0d %0d", ticks[0], ticks[1], ticks[2], ticks[3]);
    if (ticks[0] != 70 || ticks[1] != 35 || ticks[2] != 28 || ticks[3] != 20) errors = errors + 1;

    if (errors == 0) $display("PASS: 所有分频输出周期与占空比正确");
    else             $display("FAIL: %0d 处错误", errors);
    $finish;
  end
endmodule
